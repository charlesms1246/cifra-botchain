// Package config contains configuration values and defaults used by the extension.
package config

import (
	"os"
	"strconv"
	"time"
)

const (
	Version = "0.1.0"

	// OPType and OPCommand strings — must match the bytes32 constants in contracts/InstructionSender.sol.
	OPTypeKey       = "KEY"
	OPCommandUpdate = "UPDATE"
	OPCommandSign   = "SIGN"

	// Cifra invoice risk scoring. OriginalMessage is ECIES-encrypted buyer
	// payment-history data; the enclave decrypts, scores it, and returns a
	// signed grade. Must match OP_TYPE_CIFRA / OP_COMMAND_SCORE in the contract.
	OPTypeCifra    = "CIFRA"
	OPCommandScore = "SCORE"

	TimeoutShutdown = 5 * time.Second
)

// Defaults — overridden by env vars in init().
var (
	ExtensionPort = 7702
	SignPort      = 7701
	ConfigPort    = 5501
)

func init() {
	if v := os.Getenv("EXTENSION_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			ExtensionPort = n
		}
	}
	if v := os.Getenv("SIGN_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			SignPort = n
		}
	}
	if v := os.Getenv("CONFIG_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			ConfigPort = n
		}
	}
}
