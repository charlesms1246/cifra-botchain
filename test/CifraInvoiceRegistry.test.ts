import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { CifraInvoiceRegistry } from "../typechain-types";

// Status enum mirror (matches CifraInvoiceRegistry.Status).
const Status = { None: 0, Registered: 1, Funded: 2, Settled: 3, Defaulted: 4 } as const;

describe("CifraInvoiceRegistry", () => {
    let registry: CifraInvoiceRegistry;
    let owner: any, supplier: any, vault: any, other: any;

    const buyerCommitment = ethers.keccak256(ethers.toUtf8Bytes("buyer:acme-corp"));
    const ref = ethers.keccak256(ethers.toUtf8Bytes("INV-2026-001"));
    const faceAmount = ethers.parseUnits("10000", 6); // 10,000 ASSET (6 dp) — units are arbitrary here
    let dueDate: number;

    beforeEach(async () => {
        [owner, supplier, vault, other] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("CifraInvoiceRegistry");
        registry = (await Factory.deploy()) as unknown as CifraInvoiceRegistry;
        await registry.waitForDeployment();
        dueDate = (await time.latest()) + 30 * 24 * 3600; // 30 days out
    });

    async function register() {
        return registry.connect(supplier).registerInvoice(buyerCommitment, faceAmount, dueDate, ref);
    }

    async function id() {
        return registry.computeInvoiceId(supplier.address, buyerCommitment, faceAmount, dueDate, ref);
    }

    describe("registerInvoice", () => {
        it("registers and emits, with a deterministic id", async () => {
            const expectedId = await id();
            await expect(register())
                .to.emit(registry, "InvoiceRegistered")
                .withArgs(expectedId, supplier.address, buyerCommitment, faceAmount, dueDate);

            const inv = await registry.getInvoice(expectedId);
            expect(inv.supplier).to.equal(supplier.address);
            expect(inv.buyerCommitment).to.equal(buyerCommitment);
            expect(inv.faceAmount).to.equal(faceAmount);
            expect(inv.dueDate).to.equal(dueDate);
            expect(inv.status).to.equal(Status.Registered);
            expect(await registry.exists(expectedId)).to.equal(true);
        });

        it("dedupes: identical registration reverts", async () => {
            await register();
            await expect(register()).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
        });

        it("distinct ref => distinct invoice", async () => {
            await register();
            const ref2 = ethers.keccak256(ethers.toUtf8Bytes("INV-2026-002"));
            await expect(
                registry.connect(supplier).registerInvoice(buyerCommitment, faceAmount, dueDate, ref2)
            ).to.emit(registry, "InvoiceRegistered");
        });

        it("rejects zero amount and past due date", async () => {
            await expect(
                registry.connect(supplier).registerInvoice(buyerCommitment, 0, dueDate, ref)
            ).to.be.revertedWithCustomError(registry, "InvalidAmount");

            const past = (await time.latest()) - 1;
            await expect(
                registry.connect(supplier).registerInvoice(buyerCommitment, faceAmount, past, ref)
            ).to.be.revertedWithCustomError(registry, "DueDateInPast");
        });

        it("getInvoice on unknown id reverts", async () => {
            await expect(registry.getInvoice(ethers.ZeroHash)).to.be.revertedWithCustomError(
                registry,
                "UnknownInvoice"
            );
        });
    });

    describe("setStatus", () => {
        let invoiceId: string;
        beforeEach(async () => {
            await register();
            invoiceId = await id();
            await registry.connect(owner).setStatusUpdater(vault.address, true);
        });

        it("only an authorized updater can advance status", async () => {
            await expect(
                registry.connect(other).setStatus(invoiceId, Status.Funded)
            ).to.be.revertedWithCustomError(registry, "NotStatusUpdater");
        });

        it("walks Registered -> Funded -> Settled and emits", async () => {
            await expect(registry.connect(vault).setStatus(invoiceId, Status.Funded))
                .to.emit(registry, "StatusChanged")
                .withArgs(invoiceId, Status.Registered, Status.Funded);
            await expect(registry.connect(vault).setStatus(invoiceId, Status.Settled))
                .to.emit(registry, "StatusChanged")
                .withArgs(invoiceId, Status.Funded, Status.Settled);
            expect((await registry.getInvoice(invoiceId)).status).to.equal(Status.Settled);
        });

        it("allows Registered -> Defaulted and Funded -> Defaulted", async () => {
            await registry.connect(vault).setStatus(invoiceId, Status.Defaulted);
            expect((await registry.getInvoice(invoiceId)).status).to.equal(Status.Defaulted);
        });

        it("rejects illegal transitions (e.g. Registered -> Settled, and out of terminal)", async () => {
            await expect(
                registry.connect(vault).setStatus(invoiceId, Status.Settled)
            ).to.be.revertedWithCustomError(registry, "InvalidStatusTransition");

            await registry.connect(vault).setStatus(invoiceId, Status.Funded);
            await registry.connect(vault).setStatus(invoiceId, Status.Settled);
            await expect(
                registry.connect(vault).setStatus(invoiceId, Status.Funded)
            ).to.be.revertedWithCustomError(registry, "InvalidStatusTransition");
        });

        it("setStatus on unknown invoice reverts", async () => {
            await expect(
                registry.connect(vault).setStatus(ethers.ZeroHash, Status.Funded)
            ).to.be.revertedWithCustomError(registry, "UnknownInvoice");
        });
    });

    describe("admin", () => {
        it("only owner sets updaters / transfers ownership", async () => {
            await expect(
                registry.connect(other).setStatusUpdater(vault.address, true)
            ).to.be.revertedWithCustomError(registry, "NotOwner");
            await expect(
                registry.connect(other).transferOwnership(other.address)
            ).to.be.revertedWithCustomError(registry, "NotOwner");

            await registry.connect(owner).transferOwnership(other.address);
            expect(await registry.owner()).to.equal(other.address);
        });

        it("rejects zero-address updater/owner", async () => {
            await expect(
                registry.connect(owner).setStatusUpdater(ethers.ZeroAddress, true)
            ).to.be.revertedWithCustomError(registry, "ZeroAddress");
        });
    });
});
