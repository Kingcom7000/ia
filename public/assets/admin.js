loadDashboard();

const campaignForm = document.querySelector("#campaignForm");
const campaignStatus = document.querySelector("#campaignStatus");
const adminActionStatus = document.querySelector("#adminActionStatus");
const runAdminAction = document.querySelector("#runAdminAction");
let lastDashboardData = null;

campaignForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  campaignStatus.textContent = "Création de la campagne...";

  const response = await fetch("/api/brevo/campaign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(campaignForm).entries())),
  });
  const result = await response.json();

  campaignStatus.textContent = result.message || result.error || "Réponse reçue.";
  campaignStatus.className = result.ok ? "status ok" : "status warn";
  await loadDashboard();
});

runAdminAction?.addEventListener("click", async () => {
  const contactId = document.querySelector("#contactSelect").value;
  const action = document.querySelector("#adminAction").value;

  if (!contactId) {
    adminActionStatus.textContent = "Créez d'abord une analyse.";
    adminActionStatus.className = "status warn";
    return;
  }

  adminActionStatus.textContent = "Validation en cours...";
  const isPurchase = ["CHECKUP_27", "BUMP_17", "UPSELL_97"].includes(action);
  const response = await fetch(isPurchase ? "/api/simulate-purchase" : "/api/commercial-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(isPurchase ? { contactId, productCode: action } : { contactId, eventName: action }),
  });
  const result = await response.json();

  adminActionStatus.textContent = result.product?.name || result.brevo?.message || result.message || result.error || "Étape validée.";
  adminActionStatus.className = result.ok ? "status ok" : "status warn";
  await loadDashboard();
});

async function loadDashboard() {
  const response = await fetch("/api/admin/metrics");
  const data = await response.json();
  lastDashboardData = data;
  const metrics = data.metrics;
  document.querySelector("#testBadge").hidden = !data.testMode;

  document.querySelector("#metrics").innerHTML = [
    ["Analyses", metrics.diagnosticsStarted],
    ["Terminés", metrics.diagnosticsCompleted],
    ["Ventes 17€", metrics.sales27],
    ["Décodeurs 17€", metrics.bumps17],
    ["Sessions 75€", metrics.sales97],
    ["RDV Calendly", metrics.bookings],
    ["Erreurs Brevo", metrics.brevoErrors],
    ["Conv. 17€", `${metrics.conversion27}%`],
  ]
    .map(([label, value]) => `<article><strong>${value}</strong><span>${label}</span></article>`)
    .join("");

  document.querySelector("#contactSelect").innerHTML = data.contacts.length
    ? data.contacts.map((contact) => `<option value="${contact.id}">${escapeHtml(contact.company)} · ${escapeHtml(contact.email)}</option>`).join("")
    : `<option value="">Aucun contact</option>`;

  document.querySelector("#diagnosticsTable").innerHTML = data.diagnostics
    .map((item) => {
      const contact = item.contact || {};
      return `<tr>
        <td>${escapeHtml(contact.company || "")}</td>
        <td>${escapeHtml(contact.sector || "")}</td>
        <td>${item.score}/100</td>
        <td>${escapeHtml(item.maturity)}</td>
        <td>${escapeHtml(item.risk)}</td>
      </tr>`;
    })
    .join("");

  document.querySelector("#contactsTable").innerHTML = data.contacts
    .map((contact) => `<tr>
      <td>${escapeHtml(contact.company || "")}</td>
      <td>${escapeHtml(contact.email || "")}</td>
      <td>${escapeHtml(contact.sector || "")}</td>
      <td>${escapeHtml(contact.location || "")}</td>
    </tr>`)
    .join("");

  document.querySelector("#brevoLogs").innerHTML = data.brevoLogs
    .map((log) => `<p class="${log.ok ? "ok" : "warn"}"><strong>${escapeHtml(log.action)}</strong> ${escapeHtml(log.message)}</p>`)
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
