/* ─── AI seam — Designer LLD drafting ────────────────────────────────────────
   Talks to the same `claude` Edge Function the ODM app deploys (the key stays
   server-side). Off by default: with VITE_CLAUDE_PROXY_URL unset, aiEnabled is
   false and the wizard falls back to the offline Designer-LLD template.       */

const proxyUrl = String(import.meta.env.VITE_CLAUDE_PROXY_URL || "").trim().replace(/^["']+|["']+$/g, "");
const model = String(import.meta.env.VITE_CLAUDE_MODEL || "").trim() || "claude-sonnet-4-5";

export const aiEnabled = Boolean(proxyUrl);

export async function claude(prompt, { system, maxTokens = 1800 } = {}) {
  if (!proxyUrl) throw new Error("AI proxy not configured");
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error) throw new Error(body?.error?.message || `AI HTTP ${res.status}`);
  return (body?.content || []).map((c) => c?.text || "").join("").trim();
}

export const designerPrompt = (customerLLD, projectName, kind) =>
  `You are Elecbits' senior solution architect. Translate this customer LLD into a concise DESIGNER LLD for project "${projectName}" (${kind} delivery). Sections: 1 System architecture, 2 Hardware blocks & key component directions, 3 Firmware architecture, 4 Enclosure & mechanical, 5 Interfaces & connectivity, 6 Power budget, 7 Test & compliance hooks, 8 Open questions for the client. Be specific and buildable; an engineer starts work from this document without asking a single question.\n\nCUSTOMER LLD:\n${String(customerLLD || "").slice(0, 3500)}`;

export const fallbackDesigner = (projectName, kind) =>
  `DESIGNER LLD — ${projectName} (${kind})

1. SYSTEM ARCHITECTURE
   [Main controller] ↔ [sensors/inputs] ↔ [outputs/actuators] ↔ [connectivity] ↔ [power]
   — draw the block diagram from the customer LLD answers before design starts.

2. HARDWARE BLOCKS & COMPONENT DIRECTION
   - MCU/SoC: choose against the connectivity + compute needs (note alternates).
   - Sensors / inputs: one line per block, interface named (I2C/SPI/ADC…).
   - Outputs: driver strategy per actuator.

3. FIRMWARE ARCHITECTURE
   - RTOS vs bare-metal, OTA strategy, provisioning & diagnostics command set.

4. ENCLOSURE & MECHANICAL
   - Route per customer answer (off-the-shelf / printed / moulded), IP target,
     mounting, connector cutouts, thermal path.

5. INTERFACES & CONNECTIVITY
   - Protocol list with roles; antenna strategy; certification impact.

6. POWER BUDGET
   - Source, rails, worst-case draw per mode, battery sizing if applicable.

7. TEST & COMPLIANCE HOOKS
   - Test points, programming header, self-test plan, cert pre-scans.

8. OPEN QUESTIONS FOR THE CLIENT
   - List every TBD from the customer LLD here with an owner and a date.

(Offline template — edit every section against the customer LLD, then accept.)`;
