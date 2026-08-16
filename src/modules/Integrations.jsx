/* ─── Integrations — every seam, visible ─────────────────────────────────────
   The same philosophy as the ODM app: each integration is off by default,
   degrades gracefully, and its state is shown on screen rather than guessed. */

import { useState } from "react";
import { Database, FolderOpen, Sparkles, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { useUlm } from "../data.jsx";
import { Pill, Btn, Section, SectionTitle, KV } from "../ui.jsx";
import { supabaseEnabled, supabaseUrl } from "../lib/supabase.js";
import { driveConfigured, drivePing } from "../lib/ulmDrive.js";
import { aiEnabled } from "../lib/ai.js";

const Light = ({ on, warn }) => (
  <Pill color={on ? "var(--green)" : warn ? "var(--amber)" : "var(--txt2)"}>
    {on ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />} {on ? "connected" : "off — demo/seam mode"}
  </Pill>
);

export default function IntegrationsModule() {
  const { live } = useUlm();
  const [ping, setPing] = useState(null);
  const [busy, setBusy] = useState(false);

  const doPing = async () => {
    setBusy(true);
    setPing(await drivePing());
    setBusy(false);
  };

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <Section>
        <SectionTitle icon={Database} right={<Light on={supabaseEnabled} warn />}>Supabase — the shared database</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5 }}>
          <KV k="Project" v={supabaseEnabled ? supabaseUrl : "not configured — running on local seed data"} mono />
          <KV k="Reads" v="core.people (profiles) · core.orgs · core.projects · core.intake · ulm.*" mono />
          <KV k="Writes" v="ulm.portal_* wrappers only (SECURITY DEFINER, admin-gated)" mono />
        </div>
        <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--txt2)", lineHeight: 1.65 }}>
          Same Supabase project as the ODM PMS. Setup: run <b>supabase/10-ulm-tool.sql</b> after the schema files, then add <b>ulm</b> to Settings → API → Exposed schemas (alongside core and pms), and set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
        </div>
      </Section>

      <Section>
        <SectionTitle icon={FolderOpen} right={<Light on={driveConfigured} warn />}>Google Drive — registers &amp; folder provisioning</SectionTitle>
        <div style={{ fontSize: 11.5, color: "var(--txt2)", lineHeight: 1.65 }}>
          The Apps Script web app (<b>google-apps-script/ulm-drive.gs</b>) owns the Client-ID and Project-ID register sheets, replicates the project template folder (renamed to the Project ID), and writes template-library links into the process-map sheet inside each new project folder. Deploy it as a web app (execute as you · access: anyone), then set VITE_ULM_DRIVE_URL and VITE_ULM_DRIVE_TOKEN.
        </div>
        {driveConfigured && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div><Btn small icon={RefreshCw} onClick={doPing} disabled={busy}>{busy ? "Pinging…" : "Test the connection"}</Btn></div>
            {ping && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {ping.ok ? (
                  <>
                    <KV k="Registry folder" v={ping.registryFolder} />
                    <KV k="Template folder" v={ping.templateFolder} />
                    <KV k="Projects parent" v={ping.projectsParent} />
                    <KV k="Template library" v={ping.templateLibrary} />
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>{ping.error}</span>
                )}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section>
        <SectionTitle icon={Sparkles} right={<Light on={aiEnabled} />}>Claude — Designer-LLD drafting</SectionTitle>
        <div style={{ fontSize: 11.5, color: "var(--txt2)", lineHeight: 1.65 }}>
          Points at the same <b>claude</b> Edge Function the ODM app deploys (the API key stays server-side). Off, the wizard's Designer-LLD gate uses the structured offline template instead. Set VITE_CLAUDE_PROXY_URL to switch on.
        </div>
      </Section>

      <Section>
        <SectionTitle icon={Database}>{live ? "Live mode" : "Demo mode"}</SectionTitle>
        <div style={{ fontSize: 11.5, color: "var(--txt2)", lineHeight: 1.65 }}>
          {live
            ? "Reading and writing the shared database. The view-as switcher (top right) changes what you look at; what you may decide is fixed by your own profile's role."
            : "No Supabase env vars — the portal runs on seeded local data (persisted in this browser) so every flow can be exercised end-to-end. Configure .env to go live; see README.md for the full checklist."}
        </div>
      </Section>
    </div>
  );
}
