// Command scorer is Cifra's invoice risk-scoring service.
//
// It runs the published, deterministic scoring model over a buyer's private payment history and
// returns a signed grade that CifraAttestationNFT will accept on-chain. It holds no state, has
// no database, and never writes the inputs anywhere — only the decision is logged.
//
//	SCORER_SIGNING_KEY     (required) hex secp256k1 key; its address must equal
//	                       CifraAttestationNFT.scorerAddress() on the target chain
//	CHAIN_ID               (required) 677 mainnet / 968 testnet — bound into every signature
//	SCORER_ENCRYPTION_KEY  (optional) hex secp256k1 key for ECIES request payloads
//	IMAGE_DIGEST           (optional) container digest, signed into every result
//	TRUSTED_SOURCES        (optional) comma-separated addresses allowed to sign provenance
//	PORT                   (optional) defaults to 8080, Cloud Run's contract
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/charlesms1246/cifra/scorer/internal/config"
	"github.com/charlesms1246/cifra/scorer/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	srv, err := server.New(cfg)
	if err != nil {
		log.Fatalf("startup: %v", err)
	}

	log.Printf("cifra scorer starting")
	log.Printf("  model        %s", config.ModelVersion)
	log.Printf("  scorer       %s  (must equal CifraAttestationNFT.scorerAddress())", srv.ScorerAddress())
	log.Printf("  chainId      %d", cfg.ChainID)
	if cfg.ImageDigest == "" {
		log.Printf("  image        (unpinned local build — recorded on-chain as zero)")
	} else {
		log.Printf("  image        %s", cfg.ImageDigest)
	}
	if cfg.EncryptionKey == "" {
		log.Printf("  encryption   disabled (plaintext over TLS only)")
	}
	if len(cfg.TrustedSources) == 0 {
		log.Printf("  provenance   disabled (no TRUSTED_SOURCES)")
	}

	httpSrv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Cloud Run sends SIGTERM before reclaiming an instance; drain rather than drop in-flight
	// scoring requests.
	idle := make(chan struct{})
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpSrv.Shutdown(ctx); err != nil {
			log.Printf("shutdown: %v", err)
		}
		close(idle)
	}()

	log.Printf("listening on :%d", cfg.Port)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("serve: %v", err)
	}
	<-idle
}
