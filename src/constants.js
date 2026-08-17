/* ─── Shared constants ────────────────────────────────────────────────────────
   The theme objects, code tables and slot lists are carried VERBATIM from the
   ODM PMS app (src/App.jsx there), so the two tools look and number things
   identically. ULM-specific vocabulary (sanction states, kinds, decisions)
   lives at the bottom.                                                        */

export const MONO = "'IBM Plex Mono',monospace";

export const DARK = { "--bg": "#0c0e13", "--s1": "#111520", "--s2": "#161c2a", "--s3": "#1e2740", "--bdr": "#1f2d4a", "--bdr2": "#2a3d60", "--txt": "#e2e8f5", "--txt2": "#7a90b8", "--txt3": "#3d5080", "--acc": "#2563eb", "--green": "#16a34a", "--red": "#dc2626", "--amber": "#d97706", "--blue": "#2563eb", "--purple": "#7c3aed", "--coral": "#ea580c", "--soft": "#16213a" };
export const LIGHT = { "--bg": "#f8fafc", "--s1": "#ffffff", "--s2": "#f1f5f9", "--s3": "#e2e8f0", "--bdr": "#e2e8f0", "--bdr2": "#cbd5e1", "--txt": "#1e293b", "--txt2": "#64748b", "--txt3": "#94a3b8", "--acc": "#2563eb", "--green": "#16a34a", "--red": "#dc2626", "--amber": "#d97706", "--blue": "#2563eb", "--purple": "#7c3aed", "--coral": "#ea580c", "--soft": "#eff6ff" };

/* The JPG logo sits on a white chip in dark mode. */
export const logoChip = (dark, h) => ({ height: h, width: "auto", display: "block", background: dark ? "#fff" : "transparent", padding: dark ? "5px 9px" : 0, borderRadius: 8, boxSizing: "content-box" });

/* ── The Elecbits ID scheme ────────────────────────────────────────────────
   As used in the live registers:

     Client   Eb-{industry}-{orgSize}-{seq}                    Eb-10-EL-03
     Project  EbX-{industry}-{orgSize}-{clientSeq}-{projSeq}   EbX-22-PL-03-47

   Both sequences are GLOBAL and continue the highest number already in the
   register sheet — which is why the portal asks Drive for the next id rather
   than counting its own rows. These builders are the offline fallback for
   when the Drive backend is unreachable.                                    */
export const pad2 = (n) => (String(n).length < 2 ? "0" + n : String(n));
export const seqOf = (id) => {
  const m = String(id || "").trim().match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : NaN;
};
export const makeClientId = (industryCode, sizeCode, seq) =>
  `Eb-${industryCode}-${sizeCode}-${pad2(seq)}`;
export const makeProjectId = (industryCode, sizeCode, clientSeq, projSeq) =>
  `EbX-${industryCode}-${sizeCode}-${pad2(clientSeq)}-${pad2(projSeq)}`;

/* ── Client ID codes — the historical Elecbits scheme ────────────────────── */
export const INDUSTRY_CODES = [["Electric Vehicle", "01"], ["EMS", "02"], ["Just IoT", "03"], ["IIoT", "04"], ["Home Automation", "05"], ["Medical & Healthcare", "06"], ["Energy Meter & Metering", "07"], ["Wearables", "08"], ["Camera & Opticals", "09"], ["Agri/Farm/Food Tech", "10"], ["AR/VR/AI", "11"], ["EdTech", "12"], ["Industrial/Machine Setup", "13"], ["ERP Solutions", "14"], ["Robotics", "15"], ["Information Technology", "16"], ["Defence/Military", "17"], ["Automotive", "18"], ["Battery Manufacturer", "19"], ["Consumer Electronics", "20"], ["Other", "21"], ["Government & Alliance", "22"], ["Freelance/Individual", "23"], ["Logistics/Fleet", "24"], ["Fintech", "25"], ["Aerospace", "26"], ["BLDC", "27"], ["Renewables", "28"], ["Oil & Gas", "29"], ["Smart Home", "30"], ["Research", "31"], ["E-Mobility", "32"], ["Infrastructure", "33"], ["Toys and Games", "34"], ["Incubator", "35"], ["Security/Surveillance", "36"], ["Components Mfg", "37"], ["Drone Tech", "38"], ["Solar", "39"], ["IT Hardware", "40"], ["Display Manufacturers", "41"], ["Industrial Applications", "42"]].map(([label, code]) => ({ label, code }));

export const ORG_SIZES = [
  { label: "Proto Level — Small Hardware Startups", code: "PL" },
  { label: "Mid Level — Hardware Startups", code: "ML" },
  { label: "Enterprise — Large Product Companies", code: "EL" },
  { label: "EMS", code: "EM" },
  { label: "Individuals / Unknown", code: "UN" },
  { label: "Government Organisation", code: "GO" },
];

export const TEAM_SLOTS = ["PM (Project Manager)", "Senior PM (Technical Manager)", "Sr. Hardware Engineer", "Jr. Hardware Engineer", "Sr. Firmware Engineer", "Jr. Firmware Engineer", "Industrial Designer", "Tester / QA", "Supply Chain", "Solution Architect"];

/* Delivery status colors — same palette as the ODM app's projects list. */
export const STATUSES = [
  { k: "Planning", c: "var(--purple)" },
  { k: "In Progress", c: "var(--blue)" },
  { k: "On Hold", c: "var(--amber)" },
  { k: "Delayed", c: "var(--red)" },
  { k: "Completed", c: "var(--green)" },
];

/* ── ULM vocabulary ────────────────────────────────────────────────────────── */

/* The bifurcation: which delivery tool owns a sanctioned project. */
export const KINDS = [
  { k: "odm", label: "ODM", full: "ODM — design & engineering", tool: "PMS ODM", c: "var(--blue)" },
  { k: "boxbuild", label: "Box Build", full: "Box Build — assembly & production", tool: "PMS Box Build", c: "var(--coral)" },
  { k: "product", label: "Product", full: "Product — catalogue & stock", tool: "PMS Product", c: "var(--purple)" },
];
export const kindOf = (k) => KINDS.find((x) => x.k === k) || null;

/* sanction_state on core.projects — ULM's own lifecycle. */
export const SANCTION_STATES = {
  draft: { label: "Draft", c: "var(--txt3)" },
  requested: { label: "Awaiting sanction", c: "var(--amber)" },
  sanctioned: { label: "Sanctioned", c: "var(--green)" },
  unsanctioned: { label: "Un-sanctioned", c: "var(--red)" },
  on_hold: { label: "On hold", c: "var(--amber)" },
  closed: { label: "Closed", c: "var(--txt2)" },
};

/* ulm.decide() actions the portal can take from a given state. */
export const DECIDE_ACTIONS = [
  { k: "sanction", label: "Sanction", needsKind: true, kind: "green", from: ["draft", "requested", "unsanctioned"] },
  { k: "unsanction", label: "Un-sanction", kind: "danger", from: ["sanctioned", "on_hold"] },
  { k: "hold", label: "Put on hold", kind: "ghost", from: ["sanctioned"] },
  { k: "resume", label: "Resume", kind: "green", from: ["on_hold"] },
  { k: "route", label: "Re-route", needsKind: true, kind: "ghost", from: ["sanctioned", "on_hold", "requested"] },
  { k: "close", label: "Close", kind: "ghost", from: ["sanctioned", "on_hold", "unsanctioned"] },
  { k: "reopen", label: "Reopen", kind: "green", from: ["closed"] },
];

/* The four questions a ULM review actually asks (ulm.reviews columns). */
export const REVIEW_AXES = [
  { k: "feasibility", label: "Feasibility", hint: "can we build it" },
  { k: "capacity", label: "Capacity", hint: "do we have the people" },
  { k: "commercial", label: "Commercial", hint: "is the money right" },
  { k: "strategic", label: "Strategic", hint: "should Elecbits do this" },
];

/* ── Customer LLD questionnaire (wizard hard gate #2) ──────────────────────── */
export const LLD_QUESTIONS = [
  { id: "q1", sec: "Product", text: "What is the product, in one sentence?", hint: "what it does, for whom", type: "text" },
  { id: "q2", sec: "Product", text: "Who is the end user and where does the unit live?", hint: "indoor / outdoor / wearable / vehicle…", type: "text" },
  { id: "q3", sec: "Product", text: "What stage is this?", type: "chips", chips: ["Idea", "Proof of concept", "Prototype exists", "Redesign of existing", "Production-ready design"] },
  { id: "q4", sec: "Functions", text: "List the top user-facing functions.", hint: "the 3–6 things it must do", type: "text" },
  { id: "q5", sec: "Functions", text: "What sensors / inputs does it need?", hint: "temperature, motion, buttons, camera…", type: "text" },
  { id: "q6", sec: "Functions", text: "What outputs / actuators?", hint: "display, LEDs, motor, relay, speaker…", type: "text" },
  { id: "q7", sec: "Connectivity", text: "Which wireless protocols apply?", type: "chips", multi: true, chips: ["WiFi", "BLE", "Bluetooth Classic", "LoRa", "GSM/LTE", "NB-IoT", "Zigbee", "GPS/GNSS", "NFC", "None"] },
  { id: "q8", sec: "Connectivity", text: "Which wired interfaces?", type: "chips", multi: true, chips: ["USB", "Ethernet", "RS-485", "CAN", "UART/Debug", "SD card", "None"] },
  { id: "q9", sec: "Connectivity", text: "Does it talk to a cloud / app?", type: "chips", chips: ["Own cloud", "Third-party cloud", "Mobile app only", "Fully offline", "TBD"] },
  { id: "q10", sec: "Power", text: "How is it powered?", type: "chips", chips: ["Mains AC", "USB", "Battery — rechargeable", "Battery — primary", "Solar", "Vehicle 12/24V", "PoE"] },
  { id: "q11", sec: "Power", text: "If battery: target life between charges?", hint: "hours / days / months", type: "text" },
  { id: "q12", sec: "Software", text: "Who builds the firmware?", type: "chips", chips: ["Elecbits", "Client", "Shared", "TBD"] },
  { id: "q13", sec: "Software", text: "OTA updates needed?", type: "chips", chips: ["Yes", "No", "TBD"] },
  { id: "q14", sec: "Physical", text: "Size / form-factor constraints?", hint: "max dimensions, mounting, connectors reachable…", type: "text" },
  { id: "q15", sec: "Physical", text: "Enclosure expectations?", type: "chips", chips: ["Off-the-shelf", "3D printed", "Injection moulded", "Sheet metal", "Client provides", "TBD"] },
  { id: "q16", sec: "Physical", text: "Ingress / environment rating?", type: "chips", chips: ["Indoor only", "IP54", "IP65", "IP67", "Automotive", "TBD"] },
  { id: "q17", sec: "Certs", text: "Which certifications are in scope?", type: "chips", multi: true, chips: ["BIS", "CE", "FCC", "RoHS", "UL", "Automotive (AIS)", "Medical (ISO 13485)", "None yet", "TBD"] },
  { id: "q18", sec: "Cost & Time", text: "Target unit cost at volume?", hint: "₹ or $ per unit, and the volume assumed", type: "text" },
  { id: "q19", sec: "Cost & Time", text: "First-batch quantity and overall annual volume?", type: "text" },
  { id: "q20", sec: "Cost & Time", text: "Hard external deadlines?", hint: "trade show, funding milestone, season…", type: "text" },
  { id: "q21", sec: "Cost & Time", text: "What does the client value most?", type: "chips", chips: ["Speed", "Unit cost", "Reliability", "Feature completeness"] },
];

export const LLD_SECTIONS = [...new Set(LLD_QUESTIONS.map((q) => q.sec))];
