// extension/src/popup/popup.js

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function normalizeCompanyName(value) {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(limited|ltd|llp|plc|inc|co|company|group|holdings|holding)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchSponsorIndex() {
  const url = chrome.runtime.getURL("data/sponsors/sponsors_index.json");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load sponsor index: ${response.status}`);
  return response.json();
}

function detectCoSPhrases(text) {
  const patterns = [
    {
      label: "Explicit no sponsorship",
      re: /(does not offer (visa|work)\s*sponsorship|no (visa|work)\s*sponsorship|cannot sponsor|we (do not|don't) sponsor)/i
    },
    {
      label: "No CoS",
      re: /(no\s*(certificate of sponsorship|cos)\b|not provide\s*(a\s*)?cos|cannot provide\s*(a\s*)?(certificate of sponsorship|cos))/i
    },
    {
      label: "Right to work required (warning)",
      re: /(must have (the )?right to work|right to work in the uk required|must already have the right to work)/i
    }
  ];

  const matches = [];
  for (const p of patterns) {
    if (p.re.test(text)) matches.push(p.label);
  }

  if (matches.length === 0) return "No obvious refusal language found";
  return matches.join(" | ");
}

function findSponsorMatch(company, sponsorIndex) {
  const normalizedCompany = normalizeCompanyName(company);
  if (!normalizedCompany) return null;

  const exact = sponsorIndex[normalizedCompany];
  if (exact) return { type: "exact", raw: exact };

  const companyTokens = new Set(normalizedCompany.split(" ").filter((t) => t.length >= 3));
  const companyKey = normalizedCompany;

  let best = null;

  for (const sponsorKey of Object.keys(sponsorIndex)) {
    if (sponsorKey.includes(companyKey) || companyKey.includes(sponsorKey)) {
      return { type: "contains", raw: sponsorIndex[sponsorKey] };
    }

    const sponsorTokens = sponsorKey.split(" ").filter((t) => t.length >= 3);
    let overlap = 0;
    for (const t of sponsorTokens) {
      if (companyTokens.has(t)) overlap += 1;
    }

    if (overlap >= 2) {
      if (!best || overlap > best.overlap) best = { type: "token", raw: sponsorIndex[sponsorKey], overlap };
    }
  }

  return best;
}

async function extractFromPage(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clean = (v) => (v || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
      const host = location.hostname;

      const getFullText = () => clean(document.documentElement?.innerText || document.body?.innerText || "");

      const safeJsonParse = (text) => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      };

      const extractFromJsonLd = () => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const s of scripts) {
          const json = safeJsonParse(s.textContent || "");
          if (!json) continue;

          const objects = Array.isArray(json) ? json : [json];

          for (const obj of objects) {
            const hiringOrg =
              obj?.hiringOrganization ||
              obj?.hiringOrganisation ||
              obj?.hiring_organization ||
              obj?.organization ||
              obj?.author;

            const companyName =
              (typeof hiringOrg === "string" ? hiringOrg : "") ||
              hiringOrg?.name ||
              hiringOrg?.legalName ||
              obj?.publisher?.name ||
              obj?.sourceOrganization?.name;

            const title = obj?.title || obj?.jobTitle || obj?.name;

            if (companyName || title) {
              return {
                company: clean(companyName || ""),
                title: clean(title || "")
              };
            }
          }
        }
        return { company: "", title: "" };
      };

      const extractEmployerByLabelNearText = (labelText, fullText) => {
        const re1 = new RegExp(`${labelText}\\s*\\n\\s*([^\\n]+)`, "i");
        const re2 = new RegExp(`${labelText}\\s*:\\s*([^\\n]+)`, "i");
        const m = fullText.match(re1) || fullText.match(re2);
        return m && m[1] ? clean(m[1]) : "";
      };

      const extractNhsOrTrac = () => {
        const fullText = getFullText();

        const jsonLd = extractFromJsonLd();

        let company =
          clean(document.querySelector('a[aria-label="Organisation"]')?.textContent) ||
          clean(document.querySelector('[data-testid="employer-name"]')?.textContent) ||
          clean(document.querySelector('[data-test="employer-name"]')?.textContent) ||
          extractEmployerByLabelNearText("Employer name", fullText) ||
          extractEmployerByLabelNearText("Employer", fullText) ||
          jsonLd.company ||
          "";

        const title =
          clean(document.querySelector("h1")?.textContent) ||
          extractEmployerByLabelNearText("Job title", fullText) ||
          jsonLd.title ||
          "";

        let salary =
          extractEmployerByLabelNearText("Salary", fullText) ||
          extractEmployerByLabelNearText("Pay", fullText) ||
          "";

        const textSample = fullText.slice(0, 6000);

        return { company, title, salary, textSample, source: "nhs_trac" };
      };

      const extractGeneric = () => {
        const pickBest = (values) => {
          const cleaned = values
            .map(clean)
            .filter(Boolean)
            .filter((v) => v.length >= 2 && v.length <= 120);

          if (!cleaned.length) return "";

          const scored = cleaned
            .map((v) => {
              const lower = v.toLowerCase();
              const penalty =
                (v.includes("http") ? 5 : 0) +
                (lower.includes("search") ? 3 : 0) +
                (lower.includes("results") ? 3 : 0) +
                (lower.includes("paypal") ? 2 : 0) +
                (lower.includes("glossary") ? 2 : 0);

              const bonus =
                (/(ltd|limited|plc|llp|inc|company|group|services)/i.test(v) ? 2 : 0) +
                (v.split(" ").length <= 6 ? 1 : 0);

              return { v, score: bonus - penalty };
            })
            .sort((a, b) => b.score - a.score);

          return scored[0].v;
        };

        const jsonLd = extractFromJsonLd();

        const candidates = [
          document.querySelector(".topcard__org-name-link")?.textContent,
          document.querySelector(".job-details-jobs-unified-top-card__company-name")?.textContent,
          document.querySelector("[data-company-name]")?.textContent,
          document.querySelector('a[data-tracking-control-name*="company"]')?.textContent,
          document.querySelector('meta[property="og:site_name"]')?.content,
          document.querySelector('meta[name="author"]')?.content,
          jsonLd.company
        ];

        const company = pickBest(candidates);

        const fullText = getFullText();
        const textSample = fullText.slice(0, 6000);

        return { company, title: jsonLd.title || "", salary: "", textSample, source: "generic" };
      };

      const isNhsFamily =
        host.includes("jobs.nhs.uk") ||
        host.includes("trac.jobs") ||
        host.includes("apps.trac.jobs") ||
        host.includes("apply.jobs.nhs.uk");

      if (isNhsFamily) return extractNhsOrTrac();
      return extractGeneric();
    }
  });

  return result;
}

(async function main() {
  const statusEl = document.getElementById("status");
  const companyEl = document.getElementById("company");
  const sponsorEl = document.getElementById("sponsor");
  const cosEl = document.getElementById("cos");

  try {
    const tab = await getActiveTab();

    statusEl.textContent = "Reading page…";
    const { company, textSample } = await extractFromPage(tab.id);

    companyEl.textContent = company || "Not detected";

    statusEl.textContent = "Checking sponsor register…";
    const sponsorIndex = await fetchSponsorIndex();

    const match = company ? findSponsorMatch(company, sponsorIndex) : null;

    if (!company) {
      sponsorEl.textContent = "—";
    } else if (match) {
      const prefix = match.type === "exact" ? "✅ Sponsor" : "⚠️ Sponsor (likely match)";
      sponsorEl.textContent = `${prefix}: ${match.raw}`;
    } else {
      sponsorEl.textContent = "❌ Not found in sponsor list (may be name mismatch)";
    }

    cosEl.textContent = detectCoSPhrases(textSample || "");
    statusEl.textContent = "Done";
  } catch (err) {
    statusEl.textContent = "Error";
    sponsorEl.textContent = String(err?.message || err);
  }
})();
