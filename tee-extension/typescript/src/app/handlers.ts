/** Handler functions for the KEY extension operations. */

import http from 'node:http';
import { Framework } from '../base/types.js';
import {
  VERSION,
  OP_TYPE_KEY,
  OP_COMMAND_UPDATE,
  OP_COMMAND_SIGN,
} from './config.js';
import { abiEncodeTwo } from './abi.js';
import { signECDSA, parsePrivateKey } from './crypto.js';
import { hexToBytes, bytesToHex } from '../base/encoding.js';

/** Mutable state — the framework serializes all handler calls. */
let privateKey: Uint8Array | null = null;
let signPort = '9090';

/** Set the sign port for communicating with the TEE node. */
export function setSignPort(port: string): void {
  signPort = port;
}

/** Register the KEY handlers with the framework. */
export function register(framework: Framework): void {
  framework.handle(OP_TYPE_KEY, OP_COMMAND_UPDATE, handleKeyUpdate);
  framework.handle(OP_TYPE_KEY, OP_COMMAND_SIGN, handleKeySign);
}

/** Return a JSON-serializable snapshot of the current state. */
export function reportState(): unknown {
  return {
    hasKey: privateKey !== null,
    version: VERSION,
  };
}

/** Reset state (for testing). */
export function resetState(): void {
  privateKey = null;
}

async function handleKeyUpdate(
  msg: string,
): Promise<[string | null, number, string | null]> {
  if (!msg) {
    return [null, 0, 'originalMessage is empty'];
  }

  let ciphertext: Uint8Array;
  try {
    ciphertext = hexToBytes(msg);
  } catch (e) {
    return [null, 0, `invalid hex in originalMessage: ${e}`];
  }

  let keyBytes: Uint8Array;
  try {
    keyBytes = await decryptViaNode(ciphertext);
  } catch (e) {
    return [null, 0, `decryption failed: ${e}`];
  }

  let validatedKey: Uint8Array;
  try {
    validatedKey = parsePrivateKey(keyBytes);
  } catch (e) {
    return [null, 0, `invalid private key: ${e}`];
  }

  privateKey = validatedKey;
  console.log('private key updated');
  return [null, 1, null];
}

async function handleKeySign(
  msg: string,
): Promise<[string | null, number, string | null]> {
  if (privateKey === null) {
    return [null, 0, 'no private key stored'];
  }

  if (!msg) {
    return [null, 0, 'originalMessage is empty'];
  }

  let msgBytes: Uint8Array;
  try {
    msgBytes = hexToBytes(msg);
  } catch (e) {
    return [null, 0, `invalid hex in originalMessage: ${e}`];
  }

  let sig: Uint8Array;
  try {
    sig = signECDSA(privateKey, msgBytes);
  } catch (e) {
    return [null, 0, `signing failed: ${e}`];
  }

  let encoded: Uint8Array;
  try {
    encoded = abiEncodeTwo(msgBytes, sig);
  } catch (e) {
    return [null, 0, `ABI encoding failed: ${e}`];
  }

  const dataHex = bytesToHex(encoded);
  return [dataHex, 1, null];
}

/**
 * Call the TEE node's /decrypt endpoint.
 * Sends ciphertext as base64-encoded bytes (matching Go's []byte JSON marshaling).
 * Returns the decrypted plaintext bytes.
 */
function decryptViaNode(ciphertext: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:${signPort}/decrypt`;
    const body = JSON.stringify({
      encryptedMessage: Buffer.from(ciphertext).toString('base64'),
    });

    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) {
            reject(new Error(`node returned ${res.statusCode}: ${data}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            resolve(
              new Uint8Array(Buffer.from(parsed.decryptedMessage, 'base64')),
            );
          } catch (e) {
            reject(new Error(`decode response: ${e}`));
          }
        });
      },
    );

    req.on('error', (e) => reject(new Error(`request error: ${e.message}`)));
    req.write(body);
    req.end();
  });
}
