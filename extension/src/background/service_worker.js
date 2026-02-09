let sponsorIndexCache = null;

async function loadSponsorIndex() {
  if (sponsorIndexCache) return sponsorIndexCache;
  const url = chrome.runtime.getURL("data/sponsors/sponsors_index.json");
  const response = await fetch(url);
  sponsorIndexCache = await response.json();
  return sponsorIndexCache;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "SPONSOR_MATCH") {
      const sponsorIndex = await loadSponsorIndex();
      sendResponse({ sponsorIndex });
      return;
    }
  })();
  return true;
});
