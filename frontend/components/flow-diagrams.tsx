// Animated flow diagrams (SMIL — pure SVG, no client JS). Shared by the pitch deck and the
// landing page. Cifra palette: terracotta primary, success green.
const TERRACOTTA = "#de7356";
const GREEN = "#5bbf8f";

// Private scoring: invoice data → scoring service (never published) → signed grade → chain.
export function PrivateScoringFlow() {
  return (
    <svg viewBox="0 0 900 260" className="w-full min-w-[560px]" role="img" aria-label="Private scoring flow">
      <defs>
        <marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill="rgba(255,255,255,0.45)" />
        </marker>
      </defs>
      <g>
        <rect x="40" y="86" width="150" height="88" rx="12" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" />
        <text x="115" y="120" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="600">Invoice</text>
        <text x="115" y="140" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11">+ buyer data</text>
        <text x="115" y="156" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11">(encrypted)</text>
      </g>
      <g>
        <rect x="360" y="52" width="200" height="156" rx="16" fill="rgba(222,115,86,0.06)" stroke={TERRACOTTA} strokeWidth="1.5" strokeDasharray="6 5" />
        <circle cx="460" cy="96" r="18" fill="rgba(222,115,86,0.14)" />
        <path d="M453 96 v-5 a7 7 0 0 1 14 0 v5" fill="none" stroke={TERRACOTTA} strokeWidth="2" />
        <rect x="452" y="96" width="16" height="12" rx="2" fill={TERRACOTTA} />
        <text x="460" y="140" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="600">Scoring service</text>
        {/* "Compute Extension" was Flare's name for the TEE this used to run in. On BOT Chain
            it is an ordinary off-chain service, so the label was not a softened claim — it was
            the wrong one, naming a component that does not exist here. */}
        <text x="460" y="158" textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="11">off-chain</text>
        <text x="460" y="182" textAnchor="middle" fill={TERRACOTTA} fontSize="10.5">risk model · signs grade</text>
      </g>
      <g>
        <rect x="710" y="86" width="150" height="88" rx="12" fill="rgba(91,191,143,0.05)" stroke="rgba(91,191,143,0.35)" />
        <text x="785" y="118" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="600">BOT Chain</text>
        <text x="785" y="138" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11">attestation NFT</text>
        <circle cx="785" cy="156" r="9" fill="rgba(91,191,143,0.18)" />
        <text x="785" y="160" textAnchor="middle" fill={GREEN} fontSize="11" fontWeight="700">A</text>
      </g>
      <path id="p1" d="M190 130 H360" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" markerEnd="url(#ar)" />
      <text x="275" y="120" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="10.5">encrypted in</text>
      <path id="p2" d="M560 130 H710" fill="none" stroke="rgba(91,191,143,0.4)" strokeWidth="1.5" markerEnd="url(#ar)" />
      <text x="635" y="120" textAnchor="middle" fill={GREEN} fontSize="10.5">signed grade out</text>
      <text x="460" y="34" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="10.5">buyer data is never published on-chain</text>
      <rect width="10" height="10" rx="2" fill={TERRACOTTA}>
        <animateMotion dur="2.4s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear"><mpath href="#p1" /></animateMotion>
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="2.4s" repeatCount="indefinite" />
      </rect>
      <circle r="6" fill={GREEN}>
        <animateMotion dur="2.4s" begin="1.2s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear"><mpath href="#p2" /></animateMotion>
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

// The full loop, end-to-end — every stage on BOT Chain and live on mainnet (green ticks),
// with particles flowing through the whole pipeline.
export function FullLoopFlow() {
  const W = 152;
  const nodes = [
    { x: 8, t: "Register", s: "buyer = commitment" },
    { x: 210, t: "Score off-chain", s: "signed + model pinned", accent: true },
    { x: 412, t: "Grade NFT", s: "signed A–D" },
    { x: 614, t: "BOT / USDT vault", s: "senior · junior" },
    { x: 816, t: "Settle / default", s: "observed on-chain" },
  ];
  return (
    <svg viewBox="0 0 980 190" className="w-full min-w-[720px]" role="img" aria-label="The full loop on BOT Chain">
      <defs>
        <marker id="arL" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="rgba(255,255,255,0.4)" /></marker>
      </defs>
      {nodes.slice(0, -1).map((n, i) => (
        <path key={i} id={`seg${i}`} d={`M${n.x + W} 108 H${nodes[i + 1].x}`} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" markerEnd="url(#arL)" />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          <rect x={n.x} y={72} width={W} height={72} rx="12" fill={n.accent ? "rgba(222,115,86,0.09)" : "rgba(255,255,255,0.04)"} stroke={n.accent ? TERRACOTTA : "rgba(255,255,255,0.14)"} strokeWidth={n.accent ? 1.5 : 1} />
          <text x={n.x + W / 2} y={104} textAnchor="middle" fill="#fff" fontSize="13" fontWeight="600">{n.t}</text>
          <text x={n.x + W / 2} y={122} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="10.5">{n.s}</text>
          <g transform={`translate(${n.x + W - 18}, 64)`}>
            <circle r="9" fill="rgba(91,191,143,0.18)" stroke="rgba(91,191,143,0.5)" strokeWidth="0.75" />
            <path d="M-3.5 0 l2.2 2.4 l4.6 -4.8" stroke={GREEN} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
      ))}
      {nodes.slice(0, -1).map((_, i) => (
        <rect key={i} width="9" height="9" rx="2" fill={TERRACOTTA}>
          <animateMotion dur="2s" begin={`${i * 0.5}s`} repeatCount="indefinite"><mpath href={`#seg${i}`} /></animateMotion>
        </rect>
      ))}
      <text x="490" y="178" textAnchor="middle" fill="rgba(91,191,143,0.9)" fontSize="10.5">every step is a real on-chain transaction · live on mainnet</text>
    </svg>
  );
}

// Capital cycle: funders → vault → supplier; buyer settles → vault → funders (yield).
export function CapitalCycleFlow() {
  const node = (x: number, y: number, w: number, h: number, title: string, sub: string, accent?: boolean) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="12" fill={accent ? "rgba(222,115,86,0.08)" : "rgba(255,255,255,0.04)"} stroke={accent ? TERRACOTTA : "rgba(255,255,255,0.14)"} strokeWidth={accent ? 1.5 : 1} />
      <text x={x + w / 2} y={y + h / 2 - 4} textAnchor="middle" fill="#fff" fontSize="13" fontWeight="600">{title}</text>
      <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="10.5">{sub}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 900 320" className="w-full min-w-[560px]" role="img" aria-label="Capital cycle">
      <defs>
        <marker id="ar2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="rgba(255,255,255,0.45)" /></marker>
      </defs>
      {node(40, 130, 150, 64, "Supplier", "paid now")}
      {node(375, 128, 170, 70, "Cifra vault", "senior · junior", true)}
      {node(720, 44, 150, 62, "Funders", "deposit BOT/USDT")}
      {node(720, 214, 150, 62, "Buyer", "settles at maturity")}
      <path id="c1" d="M720 75 C 620 88, 560 110, 545 150" fill="none" stroke="rgba(91,191,143,0.4)" strokeWidth="1.5" markerEnd="url(#ar2)" />
      <text x="618" y="96" textAnchor="middle" fill={GREEN} fontSize="10.5">deposit</text>
      <path id="c2" d="M375 163 H190" fill="none" stroke={TERRACOTTA} strokeWidth="1.5" markerEnd="url(#ar2)" />
      <text x="282" y="152" textAnchor="middle" fill={TERRACOTTA} fontSize="10.5">advance (discounted)</text>
      <path id="c3" d="M720 245 C 620 232, 560 210, 545 176" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" markerEnd="url(#ar2)" />
      <text x="616" y="238" textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="10.5">pays face on-chain</text>
      <path id="c4" d="M560 150 C 640 120, 700 108, 760 100" fill="none" stroke="rgba(91,191,143,0.5)" strokeWidth="1.5" markerEnd="url(#ar2)" strokeDasharray="4 4" />
      <text x="690" y="132" textAnchor="middle" fill={GREEN} fontSize="10.5">principal + yield</text>
      <text x="460" y="300" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10.5">on default, the junior tranche absorbs the loss first — senior is protected</text>
      <circle r="5" fill={GREEN}><animateMotion dur="3s" repeatCount="indefinite"><mpath href="#c1" /></animateMotion></circle>
      <rect width="9" height="9" rx="2" fill={TERRACOTTA}><animateMotion dur="3s" begin="0.7s" repeatCount="indefinite"><mpath href="#c2" /></animateMotion></rect>
      <circle r="5" fill="rgba(255,255,255,0.7)"><animateMotion dur="3s" begin="1.4s" repeatCount="indefinite"><mpath href="#c3" /></animateMotion></circle>
      <circle r="5" fill={GREEN}><animateMotion dur="3s" begin="2.1s" repeatCount="indefinite"><mpath href="#c4" /></animateMotion></circle>
    </svg>
  );
}
