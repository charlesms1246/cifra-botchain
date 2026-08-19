package scoring

import (
	"errors"
	"testing"
)

// TestJurisdictionOracleOverride (v2 Stage A): when JurisdictionScoreBps is supplied (from the
// on-chain jurisdiction oracle) it overrides the static table, changing the risk score.
func TestJurisdictionOracleOverride(t *testing.T) {
	base := Input{InvoicesPaidOnTime: 88, InvoicesTotal: 100, InvoiceAmount: 120_000, HistoricalAvgVolume: 100_000, TenorDays: 30, JurisdictionCode: "NG"}
	withTable, err := Score(base)
	if err != nil {
		t.Fatalf("score: %v", err)
	}
	base.JurisdictionScoreBps = 9000 // oracle says lower-risk than the NG table (4000)
	withOracle, err := Score(base)
	if err != nil {
		t.Fatalf("score: %v", err)
	}
	if withOracle.JurisdictionScoreBps != 9000 {
		t.Errorf("oracle jurisdiction not used: got %d, want 9000", withOracle.JurisdictionScoreBps)
	}
	if withOracle.RiskScoreBps <= withTable.RiskScoreBps {
		t.Errorf("oracle override (9000) should raise risk vs NG table (4000): oracle %d, table %d", withOracle.RiskScoreBps, withTable.RiskScoreBps)
	}
}

// TestProvenanceCanonical pins the serialization the service and the data source must agree on.
func TestProvenanceCanonical(t *testing.T) {
	in := Input{InvoicesPaidOnTime: 88, InvoicesTotal: 100, InvoiceAmount: 120_000, HistoricalAvgVolume: 100_000}
	if got := ProvenanceCanonical(in); got != "88|100|120000|100000" {
		t.Errorf("ProvenanceCanonical = %q, want %q", got, "88|100|120000|100000")
	}
}

func TestScore_Grades(t *testing.T) {
	tests := []struct {
		name         string
		in           Input
		wantGrade    string
		wantRisk     uint32
		wantDiscount uint32
	}{
		{
			name: "perfect A",
			in: Input{
				InvoicesPaidOnTime: 100, InvoicesTotal: 100,
				InvoiceAmount: 100, HistoricalAvgVolume: 100,
				TenorDays: 0, JurisdictionCode: "US",
			},
			// (4*10000 + 3*10000 + 2*10000 + 1*9000)/10 = 9900
			wantGrade: "A", wantRisk: 9900, wantDiscount: baseRateBps + 200,
		},
		{
			name: "mid B",
			in: Input{
				InvoicesPaidOnTime: 90, InvoicesTotal: 100,
				InvoiceAmount: 200, HistoricalAvgVolume: 100,
				TenorDays: 60, JurisdictionCode: "IN",
			},
			// (4*9000 + 3*5000 + 2*5000 + 1*6500)/10 = 6750
			wantGrade: "B", wantRisk: 6750, wantDiscount: baseRateBps + 400,
		},
		{
			name: "flat C (unknown jurisdiction -> default)",
			in: Input{
				InvoicesPaidOnTime: 50, InvoicesTotal: 100,
				InvoiceAmount: 200, HistoricalAvgVolume: 100,
				TenorDays: 60, JurisdictionCode: "XX",
			},
			// all sub-scores 5000 -> 5000
			wantGrade: "C", wantRisk: 5000, wantDiscount: baseRateBps + 700,
		},
		{
			name: "poor D",
			in: Input{
				InvoicesPaidOnTime: 20, InvoicesTotal: 100,
				InvoiceAmount: 500, HistoricalAvgVolume: 100,
				TenorDays: 120, JurisdictionCode: "NG",
			},
			// (4*2000 + 3*2000 + 2*0 + 1*4000)/10 = 1800
			wantGrade: "D", wantRisk: 1800, wantDiscount: baseRateBps + 1200,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Score(tt.in)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Grade != tt.wantGrade {
				t.Errorf("grade = %q, want %q", got.Grade, tt.wantGrade)
			}
			if got.RiskScoreBps != tt.wantRisk {
				t.Errorf("riskBps = %d, want %d", got.RiskScoreBps, tt.wantRisk)
			}
			if got.DiscountRateBps != tt.wantDiscount {
				t.Errorf("discountBps = %d, want %d", got.DiscountRateBps, tt.wantDiscount)
			}
		})
	}
}

func TestSubScores(t *testing.T) {
	if got := repaymentScore(75, 100); got != 7500 {
		t.Errorf("repaymentScore(75,100) = %d, want 7500", got)
	}
	// relationship clamps to 100% when the invoice is smaller than the average.
	if got := relationshipScore(50, 100); got != bpsFull {
		t.Errorf("relationshipScore(50,100) = %d, want %d (clamped)", got, bpsFull)
	}
	if got := relationshipScore(400, 100); got != 2500 {
		t.Errorf("relationshipScore(400,100) = %d, want 2500", got)
	}
	// tenor: linear, zero at/after the cap.
	if got := tenorScore(40); got != 6667 {
		t.Errorf("tenorScore(40) = %d, want 6667", got)
	}
	if got := tenorScore(maxTenorDays); got != 0 {
		t.Errorf("tenorScore(cap) = %d, want 0", got)
	}
	if got := tenorScore(maxTenorDays + 50); got != 0 {
		t.Errorf("tenorScore(over cap) = %d, want 0", got)
	}
	if got := jurisdictionScore("ZZ"); got != jurisdictionDefaultBps {
		t.Errorf("jurisdictionScore(unknown) = %d, want %d", got, jurisdictionDefaultBps)
	}
}

func TestGradeBoundaries(t *testing.T) {
	cases := map[uint32]string{
		10000: "A", 8000: "A", 7999: "B", 6000: "B",
		5999: "C", 4000: "C", 3999: "D", 0: "D",
	}
	for risk, want := range cases {
		if got := gradeFor(risk); got != want {
			t.Errorf("gradeFor(%d) = %q, want %q", risk, got, want)
		}
	}
}

func TestScore_InvalidInput(t *testing.T) {
	bad := []Input{
		{InvoicesTotal: 0, InvoiceAmount: 1, HistoricalAvgVolume: 1},
		{InvoicesPaidOnTime: 5, InvoicesTotal: 4, InvoiceAmount: 1, HistoricalAvgVolume: 1},
		{InvoicesTotal: 10, InvoiceAmount: 0, HistoricalAvgVolume: 1},
		{InvoicesTotal: 10, InvoiceAmount: 1, HistoricalAvgVolume: 0},
	}
	for i, in := range bad {
		if _, err := Score(in); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("case %d: err = %v, want ErrInvalidInput", i, err)
		}
	}
}

func TestScore_Deterministic(t *testing.T) {
	in := Input{
		InvoicesPaidOnTime: 87, InvoicesTotal: 93,
		InvoiceAmount: 1_250_000, HistoricalAvgVolume: 900_000,
		TenorDays: 45, JurisdictionCode: "DE",
	}
	first, err := Score(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for i := 0; i < 100; i++ {
		got, err := Score(in)
		if err != nil || got != first {
			t.Fatalf("non-deterministic or errored on iter %d: got %+v err %v", i, got, err)
		}
	}
}
