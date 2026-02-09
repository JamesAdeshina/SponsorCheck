export function extractNhsJobPage() {
  const clean = (v) => (v || "").replace(/\s+/g, " ").trim();

  const getFieldValueByLabel = (labelText) => {
    const labels = Array.from(document.querySelectorAll("dt"));
    const label = labels.find((dt) => clean(dt.textContent).toLowerCase() === labelText.toLowerCase());
    if (!label) return "";
    const dd = label.nextElementSibling;
    return clean(dd?.textContent || "");
  };

  const company =
    clean(document.querySelector('a[aria-label="Organisation"]')?.textContent) ||
    getFieldValueByLabel("Employer name") ||
    clean(document.querySelector("h2")?.textContent);

  const title =
    clean(document.querySelector("h1")?.textContent) ||
    clean(document.querySelector('[data-test="job-title"]')?.textContent);

  const salary =
    getFieldValueByLabel("Salary") ||
    clean(Array.from(document.querySelectorAll("h3, p, li")).find((n) => /£\s?\d/.test(n.textContent))?.textContent);

  const main =
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    document.querySelector("#main-content") ||
    document.body;

  const description = clean(main?.innerText || "");

  return {
    company,
    title,
    salary,
    textSample: description.slice(0, 6000),
    source: "nhs"
  };
}
