const views = {
  landing: document.querySelector("#landing"),
  diagnostic: document.querySelector("#diagnostic"),
  analysis: document.querySelector("#analysis"),
  partialResult: document.querySelector("#partialResult"),
  checkout: document.querySelector("#checkout"),
  fullReport: document.querySelector("#fullReport"),
  premiumCheckout: document.querySelector("#premiumCheckout"),
  upsellSuccess: document.querySelector("#upsellSuccess"),
};

const form = document.querySelector("#checkupForm");
const steps = [...document.querySelectorAll(".step")];
const progressLabel = document.querySelector("#progressLabel");
const progressBar = document.querySelector("#progressBar");
const backButton = document.querySelector("#backButton");
const nextButton = document.querySelector("#nextButton");
const formStatus = document.querySelector("#formStatus");
const analysisText = document.querySelector("#analysisText");
const completePaymentButton = document.querySelector("#completePaymentButton");
const openPremiumCheckoutButton = document.querySelector("#openPremiumCheckoutButton");
const upsellButton = document.querySelector("#upsellButton");
const backToReportButton = document.querySelector("#backToReportButton");
const sessionLink = document.querySelector("#sessionLink");
const exampleButton = document.querySelector("#exampleButton");
const chooseCallLink = document.querySelector("#chooseCallLink");
const CRO = window.AK_CRO || {};

let currentStep = 0;
let currentContactId = null;
let currentResult = null;
let currentPayload = null;

document.querySelector("[data-start]").addEventListener("click", () => showView("diagnostic"));
exampleButton?.addEventListener("click", showExampleResult);
document.querySelector("[data-checkout]").addEventListener("click", () => {
  trackEvent("checkout_started");
  showView("checkout");
});
backButton.addEventListener("click", goBack);
nextButton.addEventListener("click", goNext);
completePaymentButton.addEventListener("click", completeCheckout);
openPremiumCheckoutButton?.addEventListener("click", () => showView("premiumCheckout"));
upsellButton?.addEventListener("click", completeUpsell);
backToReportButton?.addEventListener("click", () => showView("fullReport"));
chooseCallLink?.addEventListener("click", async () => {
  if (!currentContactId || currentContactId === "example") return;
  trackEvent("call_option_selected");
  await postJson("/api/commercial-event", { contactId: currentContactId, eventName: "RDV_INTERESSE" });
});
sessionLink?.addEventListener("click", async () => {
  if (!currentContactId) return;
  trackEvent("call_option_selected");
  await postJson("/api/commercial-event", { contactId: currentContactId, eventName: "RDV_INTERESSE" });
});

updateStep();
renderCroBlocks();
trackEvent("page_view_sales");
handlePaymentReturn();

function showView(name) {
  Object.values(views).forEach((view) => view.classList.remove("active"));
  views[name].classList.add("active");
  if (name === "premiumCheckout") trackEvent("upsell_97_viewed");
  if (name === "upsellSuccess") trackEvent("call_option_selected");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCroBlocks() {
  const h1 = document.querySelector("#salesH1");
  const subtitle = document.querySelector("#salesSubtitle");
  if (h1 && CRO.h1) h1.textContent = CRO.h1[CRO.h1Variant || "B"] || CRO.h1.B;
  if (subtitle && CRO.subtitle) subtitle.textContent = CRO.subtitle;

  document.querySelector("#socialProofSection").innerHTML = (CRO.testimonials || []).map((item) => `
    <article>
      <strong>${escapeHtml(item.firstName)} · ${escapeHtml(item.sector)} · ${escapeHtml(item.city)}</strong>
      <p>“${escapeHtml(item.quote)}”</p>
      <span>${escapeHtml(item.result)}</span>
    </article>
  `).join("");

  document.querySelector("#valueStackSection").innerHTML = `
    <div class="value-stack">
      <p class="eyebrow">Valeur reçue aujourd’hui</p>
      <h2>${escapeHtml(CRO.product?.name || "Le Révélateur de Clients Perdus™")}</h2>
      <p>${escapeHtml(CRO.product?.subtitle || "")}</p>
      <div class="value-lines">
        ${[
          ["Analyse personnalisée de votre entreprise", "350 €"],
          ["Comparaison avec 3 concurrents", "250 €"],
          ["Indice de Domination Locale™", "inclus"],
          ["Rapport des 3 freins principaux", "200 €"],
          ["Rapport des 3 opportunités rapides", "200 €"],
          ["Verdict IA", "150 €"],
        ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}
      </div>
      <div class="value-total"><span>Total valeur : 1 150 €</span><strong>Prix aujourd’hui : 17 €</strong></div>
    </div>
  `;

  ["#guaranteeSales", "#guaranteeCheckout"].forEach((selector) => {
    const node = document.querySelector(selector);
    if (node) node.innerHTML = `<strong>Garantie 30 jours</strong><p>${escapeHtml(CRO.guarantee || "")}</p>`;
  });

  const remaining = Number(CRO.weeklyAnalysisRemaining || CRO.weeklyAnalysisFallback || 18);
  document.querySelector("#scarcityBlock").innerHTML = `
    <strong>${remaining} analyses restantes cette semaine</strong>
    <p>Nous limitons les analyses à 50 par semaine pour garantir la qualité.</p>
  `;
}

function goBack() {
  if (currentStep === 0) return showView("landing");
  currentStep -= 1;
  updateStep();
}

async function goNext() {
  if (!validateStep()) return;

  if (currentStep < steps.length - 1) {
    currentStep += 1;
    updateStep();
    return;
  }

  await submitDiagnostic();
}

function updateStep() {
  steps.forEach((step, index) => step.classList.toggle("active", index === currentStep));
  progressLabel.textContent = `Étape ${currentStep + 1} sur ${steps.length}`;
  progressBar.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
  backButton.textContent = currentStep === 0 ? "Retour à l'accueil" : "Retour";
  nextButton.textContent = currentStep === steps.length - 1 ? "Analyser mon entreprise" : "Continuer";
  formStatus.textContent = "";
}

function validateStep() {
  const fields = [...steps[currentStep].querySelectorAll("input, textarea")];
  const invalid = fields.find((field) => !field.checkValidity());
  if (!invalid) return true;
  invalid.reportValidity();
  return false;
}

async function submitDiagnostic() {
  currentPayload = Object.fromEntries(new FormData(form).entries());
  showView("analysis");
  await runAnalysisAnimation();

  const result = await postJson("/api/checkup", currentPayload);
  if (!result.ok) {
    showView("diagnostic");
    formStatus.textContent = result.error || "Impossible de préparer votre lecture pour le moment.";
    return;
  }

  currentContactId = result.contactId;
  currentResult = result;
  saveTunnelState();
  renderPartialResult();
  showView("partialResult");
}

async function runAnalysisAnimation() {
  const steps = [
    "Analyse du site web",
    "Analyse Facebook",
    "Analyse LinkedIn",
    "Analyse Google Business",
    "Analyse des concurrents",
    "Calcul du score",
    "Détection des opportunités",
  ];

  const stepsNode = document.querySelector("#analysisSteps");
  stepsNode.innerHTML = steps.map((step, index) => `
    <div class="analysis-step" data-analysis-step="${index}">
      <span>${escapeHtml(step)}...</span>
      <strong>en attente</strong>
    </div>
  `).join("");

  for (let index = 0; index < steps.length; index += 1) {
    const node = stepsNode.querySelector(`[data-analysis-step="${index}"]`);
    node.classList.add("active");
    node.querySelector("strong").textContent = "en cours";
    analysisText.textContent = `${steps[index]}...`;
    await wait(520);
    node.classList.remove("active");
    node.classList.add("done");
    node.querySelector("strong").textContent = "✓ terminé";
  }
}

function renderPartialResult() {
  const company = currentPayload.company;
  const competitors = [currentPayload.competitor1, currentPayload.competitor2, currentPayload.competitor3];
  const competitorScores = buildComparisonScores(currentResult.score);

  document.querySelector("#scoreValue").textContent = currentResult.score;
  document.querySelector("#maturityBadge").textContent = currentResult.maturity;
  const subScores = buildSaasSubScores(currentResult.score, currentResult.analysis);
  document.querySelector("#personalizedPhrase").textContent =
    `${company} paraît présente dans la comparaison, mais le moteur détecte un écart possible entre ce que vous proposez et ce qui rend un concurrent plus facile à choisir.`;

  document.querySelector("#resultCards").innerHTML = [
    {
      label: "AI Insights™",
      value: "Votre entreprise paraît crédible.",
      text: `Mais ${competitors[0]} peut sembler plus simple à choisir si sa valeur est plus vite comprise.`,
      meta: "Insight principal",
    },
    {
      label: "Opportunité détectée",
      value: "Différenciation à rendre visible",
      text: `Votre offre est identifiable, mais la raison de vous choisir doit devenir plus évidente avant la demande.`,
      meta: "Impact élevé",
    },
    {
      label: "Risque identifié",
      value: "Preuves visibles insuffisantes",
      text: `Si les preuves sont moins visibles que chez certains concurrents, la confiance peut se déplacer ailleurs.`,
      meta: "Risque élevé",
    },
  ]
    .map((card) => `
      <article class="emotion-card ai-result-card">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(card.value)}</strong>
        <p>${escapeHtml(card.text)}</p>
        <em>${escapeHtml(card.meta)}</em>
      </article>
    `)
    .join("");

  document.querySelector("#resultCards").insertAdjacentHTML("beforeend", `
    <article class="emotion-card subscore-card">
      <span>Sous-scores</span>
      <strong>Ce qui pèse dans le score</strong>
      ${renderSaasSubScoreBars(subScores)}
    </article>
  `);

  document.querySelector("#competitorComparison").innerHTML = [
    { name: company, score: currentResult.score, type: "you" },
    { name: competitors[0], score: competitorScores[0] },
    { name: competitors[1], score: competitorScores[1] },
    { name: competitors[2], score: competitorScores[2] },
  ]
    .map((item) => `
      <div class="comparison-row ${item.type === "you" ? "is-you" : ""}">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <span>${item.type === "you" ? "Votre entreprise" : "Concurrent perçu"}</span>
        </div>
        <i><b style="width:${item.score}%"></b></i>
        <em>${item.score}</em>
      </div>
    `)
    .join("");
}

function showExampleResult() {
  currentPayload = {
    email: "exemple@agency-king.com",
    company: "Atelier Nova",
    sector: "rénovation intérieure",
    location: "Namur",
    website: "https://exemple.be",
    facebook: "https://facebook.com/exemple",
    linkedin: "https://linkedin.com/company/exemple",
    googleBusiness: "Atelier Nova Namur",
    mainOffer: "rénovation de cuisines sur mesure",
    targetClient: "propriétaires de maisons",
    commercialMessage: "Nous rénovons votre cuisine avec soin.",
    mainObjective: "plus de demandes de devis",
    competitor1: "Maison Concept",
    competitor2: "Reno Plus",
    competitor3: "Cuisine Expert",
  };
  currentResult = {
    ok: true,
    contactId: "example",
    score: 49,
    maturity: "Visible mais vulnérable",
    risk: "Élevé",
    analysis: null,
  };
  currentContactId = "example";
  renderPartialResult();
  showView("partialResult");
}

async function completeCheckout() {
  if (!currentContactId) return;
  completePaymentButton.disabled = true;
  completePaymentButton.textContent = "Ouverture de votre lecture complète…";

  if (currentContactId === "example") {
    renderFullReport();
    completePaymentButton.disabled = false;
    completePaymentButton.textContent = "Voir ce qui me coûte des demandes";
    showView("fullReport");
    return;
  }

  const productCodes = ["CHECKUP_27"];
  const redirected = await startMolliePayment(productCodes);
  if (redirected) return;

  await postJson("/api/simulate-purchase", { contactId: currentContactId, productCode: "CHECKUP_27" });
  trackEvent("purchase_27");
  renderFullReport();
  completePaymentButton.disabled = false;
  completePaymentButton.textContent = "Voir ce qui me coûte des demandes";
  showView("fullReport");
}

function renderFullReport() {
  const competitors = [currentPayload.competitor1, currentPayload.competitor2, currentPayload.competitor3];
  const company = currentPayload.company;
  const sector = currentPayload.sector;
  const location = currentPayload.location;
  const offer = currentPayload.mainOffer || "votre offre principale";
  const target = currentPayload.targetClient || "vos clients cibles";
  const riskText = currentResult.risk;
  const maturity = currentResult.maturity;
  const digital = currentResult.analysis;
  const observed = buildObservedContext({ company, sector, location, offer, target, competitors });
  const dimensions = buildDimensionScores(currentResult.score, digital);
  const threatening = buildThreateningCompetitor({ company, sector, location, offer, competitors, observed });
  const revenueLoss = estimateMonthlyRevenueLoss(currentResult.score, sector, target);

  document.querySelector("#fullScoreValue").textContent = currentResult.score;
  document.querySelector("#riskBadge").textContent = `${maturity} · Risque ${riskText}`;
  document.querySelector("#fullReportIntro").textContent =
    `Pour ${company}, l’enjeu est simple : aider un prospect de ${location} à comprendre plus vite pourquoi demander un devis pour ${offer}, avant qu’il ne compare avec ${competitors.join(", ")}.`;

  const understandsFast = [
    `${company} semble intervenir dans le secteur ${sector}, ce qui donne un premier repère au prospect.`,
    `La zone ${location} permet au prospect de savoir si l’entreprise peut potentiellement l’accompagner localement.`,
    `L’offre "${offer}" donne une première idée du type de demande qu’il pourrait formuler.`,
  ];

  const unclearStill = [
    `Le prospect peut ne pas comprendre assez vite pourquoi choisir ${company} plutôt qu’un autre acteur de ${sector}.`,
    `Le bénéfice concret pour ${target} mérite d’être plus évident dès le premier écran.`,
    `La différence avec ${competitors[0]} n’est pas encore suffisamment nette dans cette première lecture.`,
  ];

  const hesitation = [
    `S’il doit chercher trop longtemps les raisons de faire confiance à ${company}, il peut reporter sa prise de contact.`,
    `Si l’offre "${offer}" paraît sérieuse mais trop générale, le prospect peut demander aussi un devis à ${competitors[1]}.`,
    `Si le chemin vers la demande n’est pas évident, une intention d’achat peut devenir une simple visite sans suite.`,
  ];

  const reassurance = [
    `Des exemples courts liés à ${offer} peuvent aider le prospect à se projeter avant de demander un devis.`,
    `Des preuves visibles près du premier bouton de contact peuvent réduire la peur de se tromper.`,
    `Une phrase claire du type "pour qui, pour quoi, avec quel résultat" peut rendre ${company} plus facile à choisir.`,
  ];

  const forces = [
    {
      observation: `${company} formule déjà une offre identifiable : "${offer}".`,
      analysis: `Le prospect n’arrive pas sur une page totalement floue : il peut associer ${company} à une demande concrète.`,
      consequence: `Cela peut éviter une partie des abandons immédiats, surtout si la demande concerne ${offer}.`,
      action: `Placer cette offre près du premier bouton de prise de contact, avec une phrase orientée résultat.`,
      impact: "Moyen",
    },
    {
      observation: `La zone ${location} donne un repère concret à un prospect local.`,
      analysis: `Un dirigeant PME veut souvent savoir rapidement si l’entreprise comprend son marché local.`,
      consequence: `Cela peut augmenter la confiance avant la demande de devis, surtout face à un concurrent moins localisé.`,
      action: `Associer ${location} à des cas, types de clients ou situations locales au lieu de seulement mentionner la ville.`,
      impact: "Moyen",
    },
    {
      observation: `${company} connaît au moins trois alternatives que ses prospects peuvent regarder : ${competitors.join(", ")}.`,
      analysis: `Vous ne raisonnez pas dans le vide : vous savez contre qui votre entreprise peut être comparée.`,
      consequence: `Cette conscience concurrentielle peut éviter de perdre des demandes sans comprendre pourquoi.`,
      action: `Commencer par clarifier ce que ${company} rend plus simple, plus sûr ou plus concret que ces alternatives.`,
      impact: "Élevé",
    },
  ];

  const frictions = [
    {
      observation: `Dans les éléments fournis, l’offre "${offer}" existe, mais la raison immédiate de choisir ${company} doit être plus explicite.`,
      analysis: `Quand plusieurs entreprises semblent capables de répondre, le prospect contacte souvent celle qui réduit le plus vite son doute.`,
      consequence: `Des demandes de devis peuvent partir chez ${competitors[0]} même si votre travail est meilleur.`,
      action: `Ajouter une phrase courte qui répond à : "Pourquoi demander à ${company} plutôt qu’à une autre option ?"`,
      priority: "Élevée",
    },
    {
      observation: `Le client cible indiqué est "${target}", mais le résultat attendu pour lui peut être rendu plus tangible.`,
      analysis: `Un prospect achète moins une prestation qu’un résultat qu’il arrive à visualiser.`,
      consequence: `Il peut garder ${company} "pour plus tard" et contacter une option plus directe.`,
      action: `Transformer le bénéfice de ${offer} en résultat observable : gain de temps, réduction du risque, demandes plus qualifiées, décision plus simple.`,
      priority: "Moyenne",
    },
    {
      observation: `${competitors[1]} et ${competitors[2]} sont cités comme alternatives possibles, mais l’écart avec ${company} n’est pas encore formulé dans les informations fournies.`,
      analysis: `Si la différence n’est pas visible, le prix, la proximité ou le hasard prennent plus de place.`,
      consequence: `La comparaison peut devenir défavorable avant même un échange commercial.`,
      action: `Exprimer une différence simple sans dévoiler toute la stratégie : "Nous sommes le bon choix si..."`,
      priority: "Élevée",
    },
  ];

  const quickWins = [
    {
      action: "Ajouter 3 preuves visibles près du premier bouton de contact.",
      why: `Aujourd’hui, le prospect peut comprendre l’activité de ${company}, mais il doit voir plus vite pourquoi faire confiance avant de demander un devis.`,
      where: "Page d’accueil, juste avant ou juste après le premier appel à prendre contact.",
      impact: 5,
      effort: 2,
    },
    {
      action: `Reformuler l’offre "${offer}" en une phrase orientée résultat.`,
      why: `Une phrase plus concrète aide ${target} à comprendre immédiatement ce qu’il peut gagner en vous contactant.`,
      where: "Titre principal, description courte, fiche Google Business et profils sociaux.",
      impact: 4,
      effort: 2,
    },
    {
      action: `Créer une courte section "Pourquoi nous contacter plutôt que comparer encore ?"`,
      why: `Cette section répond à l’hésitation du prospect au moment exact où il peut partir voir ${competitors[0]}.`,
      where: "Avant le formulaire de contact ou près du bouton de demande de devis.",
      impact: 4,
      effort: 3,
    },
  ];

  const competitorReads = competitors.map((competitor, index) => ({
    name: competitor,
    better: [
      `une promesse peut-être plus directe pour un prospect de ${sector}`,
      `un repère plus rassurant au moment de demander un devis`,
      `une impression de choix plus simple`,
    ][index],
    reassurance: [
      `Si ${competitor} explique plus vite le résultat attendu, le prospect a moins d’effort à faire.`,
      `Si ${competitor} montre mieux ses preuves, le prospect peut se sentir plus en sécurité.`,
      `Si ${competitor} rend la prise de contact plus évidente, il peut capter une demande avant ${company}.`,
    ][index],
    recover: [
      `clarifier en une phrase pourquoi ${company} est un bon choix pour ${offer}`,
      `placer les preuves avant que le prospect n’ait besoin de les chercher`,
      `réduire le nombre d’étapes mentales avant la demande de devis`,
    ][index],
    premium: [
      `quels éléments précis donnent cet avantage à ${competitor}`,
      `quelles preuves ou contenus influencent vraiment la comparaison`,
      `quelles actions permettraient à ${company} de reprendre l’avantage sans copier ${competitor}`,
    ][index],
  }));

  const aiAnswer = currentResult.score >= 75 ? "Partiellement" : currentResult.score >= 55 ? "Partiellement" : "Non";

  document.querySelector("#fullReportContent").innerHTML = renderSaasReport({
    company,
    sector,
    location,
    offer,
    competitors,
    threatening,
    revenueLoss,
    quickWins,
    riskText,
    maturity,
    digital,
  });
}

function renderSaasReport({ company, sector, location, offer, competitors, threatening, revenueLoss, quickWins, riskText, maturity, digital }) {
  const subScores = buildSaasSubScores(currentResult.score, digital);
  const topOpportunity = `Votre offre "${offer}" est identifiable, mais la différence avec ${threatening.name} doit être plus immédiate.`;
  const topRisk = `Les preuves visibles peuvent être moins fortes que chez certains concurrents, ce qui peut déplacer la confiance avant la prise de contact.`;

  return `
    <section class="saas-dashboard-grid">
      <article class="saas-card domination-card">
        <p class="eyebrow">DOMINATION SCORE™</p>
        <div class="domination-score">
          <strong>${currentResult.score}</strong>
          <span>/100</span>
        </div>
        <h3>${escapeHtml(maturity)}</h3>
        <p>Score calculé à partir de votre site, vos réseaux sociaux, votre message et la comparaison avec vos concurrents.</p>
        ${renderSaasSubScoreBars(subScores)}
      </article>

      <article class="saas-card ai-insight-card">
        <p class="eyebrow">AI Insights™</p>
        <h3>${escapeHtml(company)} paraît crédible.</h3>
        <p>Cependant, vos concurrents peuvent expliquer plus clairement leur valeur ajoutée. Cela peut influencer le choix de certains prospects au moment précis où ils comparent leurs options.</p>
        <div class="insight-pills">
          <span>${escapeHtml(location)}</span>
          <span>${escapeHtml(sector)}</span>
          <span>Risque ${escapeHtml(riskText)}</span>
        </div>
      </article>
    </section>

    <section class="saas-dashboard-grid three">
      <article class="saas-card opportunity-card">
        <p class="card-icon">↗</p>
        <span>Opportunité détectée</span>
        <h3>${escapeHtml(topOpportunity)}</h3>
        <p>Impact potentiel : <strong>élevé</strong></p>
      </article>
      <article class="saas-card risk-card">
        <p class="card-icon">!</p>
        <span>Risque identifié</span>
        <h3>${escapeHtml(topRisk)}</h3>
        <p>Impact : <strong>élevé</strong></p>
      </article>
      <article class="saas-card revenue-card">
        <p class="card-icon">€</p>
        <span>Opportunités perdues probables</span>
        <h3>${revenueLoss.min}€ à ${revenueLoss.max}€ / mois</h3>
        <p>Estimation prudente basée sur le score et le secteur ${escapeHtml(sector)}.</p>
      </article>
    </section>

    <section class="saas-dashboard-grid competitor-focus-grid">
      <article class="saas-card competitor-focus">
        <p class="eyebrow">Concurrent principal</p>
        <h3>Concurrent à surveiller : ${escapeHtml(threatening.name)}</h3>
        <div class="threat-meter">
          <div><b style="width:${Math.min(96, currentResult.score + 18)}%"></b></div>
          <span>Score de menace : ${Math.min(96, currentResult.score + 18)}/100</span>
        </div>
        <p>${escapeHtml(threatening.justification)}</p>
      </article>

      <article class="saas-card action-stack">
        <p class="eyebrow">Actions prioritaires</p>
        <h3>3 leviers à traiter d’abord.</h3>
        ${quickWins.slice(0, 3).map((item) => `
          <div class="startup-action">
            <strong>${escapeHtml(item.action)}</strong>
            <p>${escapeHtml(item.why)}</p>
            <span>Impact ${stars(item.impact)} · Effort ${stars(item.effort)}</span>
          </div>
        `).join("")}
      </article>
    </section>
  `;
}

function buildSaasSubScores(score, digital) {
  if (digital?.score) {
    return [
      { label: "SEO", score: Math.round((digital.score.seo / 20) * 100) },
      { label: "Clarté", score: Math.round((digital.score.offerClarity / 20) * 100) },
      { label: "Confiance", score: clampScore(score - 8) },
      { label: "Réseaux sociaux", score: Math.round(((digital.score.socialActivity + digital.score.socialEngagement) / 30) * 100) },
      { label: "Conversion", score: Math.round((digital.score.conversion / 10) * 100) },
      { label: "Cohérence", score: Math.round((digital.score.coherence / 20) * 100) },
    ];
  }

  return [
    { label: "SEO", score: clampScore(score + 4) },
    { label: "Clarté", score: clampScore(score - 2) },
    { label: "Confiance", score: clampScore(score - 8) },
    { label: "Réseaux sociaux", score: clampScore(score - 13) },
    { label: "Conversion", score: clampScore(score - 5) },
    { label: "Cohérence", score: clampScore(score + 1) },
  ];
}

function renderSaasSubScoreBars(items) {
  return `
    <div class="saas-subscore-list">
      ${items.map((item) => `
        <div class="saas-subscore">
          <span>${escapeHtml(item.label)}</span>
          <i><b style="width:${item.score}%"></b></i>
          <strong>${item.score}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderRevenueLossEstimate({ score, sector, revenueLoss }) {
  return `
    <section class="paid-section revenue-loss-section">
      <p class="eyebrow">Ce que cela peut représenter en euros</p>
      <h3>Votre score est ${score}/100.</h3>
      <p>Cela signifie qu’une partie de vos prospects choisissent probablement un concurrent. Sur la base de votre secteur (${escapeHtml(sector)}), cela peut représenter environ <strong>${revenueLoss.min}€ à ${revenueLoss.max}€ de chiffre d’affaires mensuel perdu</strong>.</p>
      <span>${escapeHtml(revenueLoss.label)} · estimation prudente</span>
    </section>
  `;
}

function renderWowMoment({ company, competitor }) {
  return `
    <section class="paid-section wow-moment">
      <p class="eyebrow">Moment clé</p>
      <h3>Voici probablement où une partie des prospects décroche.</h3>
      <p>Votre page explique ce que vous faites, mais elle ne donne pas encore une raison claire de vous choisir plutôt que ${escapeHtml(competitor)}. C’est probablement ici qu’une partie des prospects garde ${escapeHtml(company)} en tête… puis demande un devis ailleurs.</p>
    </section>
  `;
}

function renderDigitalAnalysisSections(analysis, context) {
  const website = analysis.website;
  const facebook = analysis.facebook;
  const linkedin = analysis.linkedin;
  const coherence = analysis.coherence;

  return `
    <section class="paid-section digital-section">
      <p class="eyebrow">Analyse réelle des supports</p>
      <h3>Ce que l’application a pu lire sur votre site et vos réseaux.</h3>
      <div class="score-breakdown">
        ${renderMiniScore("SEO de base", analysis.score.seo, 20)}
        ${renderMiniScore("Clarté de l’offre", analysis.score.offerClarity, 20)}
        ${renderMiniScore("Cohérence site/réseaux", analysis.score.coherence, 20)}
        ${renderMiniScore("Activité sociale", analysis.score.socialActivity, 15)}
        ${renderMiniScore("Engagement social", analysis.score.socialEngagement, 15)}
        ${renderMiniScore("Conversion", analysis.score.conversion, 10)}
      </div>
    </section>

    ${renderWebsiteAudit(website, context)}
    ${renderMessageAudit(website, context)}
    ${renderSocialAudit("Facebook", facebook)}
    ${renderSocialAudit("LinkedIn", linkedin)}
    ${renderCoherenceAudit(coherence)}
    ${renderBusinessLosses(analysis, context)}
    ${renderPriorityCorrections(analysis, context)}
  `;
}

function renderMiniScore(label, value, max) {
  const percent = Math.round((value / max) * 100);
  return `
    <article class="mini-score">
      <div><strong>${escapeHtml(label)}</strong><span>${value}/${max}</span></div>
      <i><b style="width:${percent}%"></b></i>
    </article>
  `;
}

function renderWebsiteAudit(website, { company, offer }) {
  if (!website?.accessible) {
    return renderUnavailableSection("Analyse SEO rapide du site", website?.reason || "Le site web n’a pas pu être lu automatiquement.");
  }

  return `
    <section class="paid-section">
      <p class="eyebrow">1. Analyse SEO rapide du site</p>
      <h3>Ce que Google et un prospect peuvent comprendre vite.</h3>
      <div class="observed-grid website-observed">
        ${renderObservedItem("Title", website.title || "Non trouvé", website.seo.hasTitle ? "Le title existe. Il doit idéalement faire comprendre l’offre et la zone." : "Sans title clair, la première impression dans Google peut perdre en précision.")}
        ${renderObservedItem("Meta description", website.metaDescription || "Non trouvée", website.seo.hasMetaDescription ? "La description donne un aperçu. Elle doit donner envie de cliquer et de demander." : "Sans description, Google ou le prospect peuvent manquer de contexte.")}
        ${renderObservedItem("H1", website.h1?.[0] || "Non trouvé", website.seo.hasH1 ? "Le H1 donne le message principal de la page." : "Sans H1 lisible, le message principal est moins évident.")}
        ${renderObservedItem("H2", `${website.h2?.length || 0} repéré(s)`, website.h2?.length ? "Les intertitres aident le prospect à scanner la page." : "Peu d’intertitres rendent la lecture plus difficile.")}
        ${renderObservedItem("Appels à l’action", website.ctas?.join(", ") || "Aucun évident", website.ctas?.length ? "Le prospect trouve au moins un chemin vers la prise de contact." : "Si aucun CTA n’est évident, des demandes peuvent se perdre.")}
      </div>
      <div class="consultant-card">
        <dl>
          <div><dt>Observation réelle</dt><dd>${escapeHtml(website.observations?.[0] || `Le site de ${company} a été lu automatiquement.`)}</dd></div>
          <div><dt>Analyse</dt><dd>${escapeHtml(`Le site doit relier "${offer}" à une raison claire de prendre contact, pas seulement présenter l’activité.`)}</dd></div>
          <div><dt>Conséquence business</dt><dd>Un prospect peut comprendre votre métier mais ne pas ressentir assez vite pourquoi demander un devis maintenant.</dd></div>
          <div><dt>Action recommandée</dt><dd>Rapprocher l’offre, les preuves et le bouton de contact dans la première partie de page.</dd></div>
        </dl>
      </div>
    </section>
  `;
}

function renderMessageAudit(website, { company, offer }) {
  const sample = website?.accessible ? website.textSample : "";
  return `
    <section class="paid-section">
      <p class="eyebrow">2. Analyse du message commercial</p>
      <h3>Le prospect comprend-il pourquoi choisir ${escapeHtml(company)} ?</h3>
      <div class="consultant-card">
        <dl>
          <div><dt>Observation réelle</dt><dd>${escapeHtml(sample ? `Texte lu sur le site : "${sample.slice(0, 220)}..."` : `Le message fourni dans le formulaire mentionne : "${offer}".`)}</dd></div>
          <div><dt>Analyse</dt><dd>${escapeHtml(`Le message doit faire plus que nommer "${offer}" : il doit expliquer le bénéfice concret pour le prospect.`)}</dd></div>
          <div><dt>Conséquence business</dt><dd>Si le bénéfice reste implicite, un prospect peut comparer les prix ou contacter un concurrent plus direct.</dd></div>
          <div><dt>Action recommandée</dt><dd>Ajouter une phrase courte : pour qui, quel problème, quel résultat, pourquoi vous contacter.</dd></div>
        </dl>
      </div>
    </section>
  `;
}

function renderSocialAudit(label, source) {
  if (!source?.accessible) {
    return renderUnavailableSection(`Analyse ${label}`, source?.reason || `Nous n’avons pas pu analyser directement ce réseau. Pour une analyse plus précise, ajoutez une capture ou les 3 dernières publications.`);
  }

  return `
    <section class="paid-section">
      <p class="eyebrow">Analyse ${escapeHtml(label)}</p>
      <h3>Ce que ce réseau peut faire gagner ou perdre avant la prise de contact.</h3>
      <div class="card-list">
        <article class="consultant-card">
          <dl>
            <div><dt>Observation réelle</dt><dd>${escapeHtml(source.title || `${label} a été lu, mais le titre est peu exploitable.`)}</dd></div>
            <div><dt>Analyse</dt><dd>${escapeHtml(source.activity?.note || "La régularité exacte n’est pas confirmée automatiquement.")}</dd></div>
            <div><dt>Conséquence business</dt><dd>${escapeHtml(source.engagement?.hasVisibleInteractions ? "Des interactions visibles peuvent réduire le doute avant contact." : "Sans interaction visible confirmée, le réseau rassure moins au moment de comparer.")}</dd></div>
            <div><dt>Action recommandée</dt><dd>Faire apparaître clairement l’offre, un exemple concret et une invitation simple à prendre contact.</dd></div>
          </dl>
        </article>
      </div>
    </section>
  `;
}

function renderCoherenceAudit(coherence) {
  return `
    <section class="paid-section">
      <p class="eyebrow">5. Cohérence entre site et réseaux</p>
      <h3>Un prospect comprend-il la même chose partout ?</h3>
      <div class="bullet-block">
        <ul>${coherence.observations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
    </section>
  `;
}

function renderBusinessLosses(analysis, { company, competitors }) {
  const inaccessible = [analysis.facebook, analysis.linkedin].filter((source) => !source.accessible).length;
  return `
    <section class="paid-section">
      <p class="eyebrow">6. Ce que cela peut faire perdre comme demandes</p>
      <h3>Les pertes probables ne viennent pas toujours d’un mauvais service.</h3>
      <div class="card-list">
        ${[
          `Si le site de ${company} explique l’activité sans rendre la demande évidente, des prospects peuvent repartir sans cliquer.`,
          `Si Facebook ou LinkedIn ne confirment pas clairement la même promesse, la comparaison avec ${competitors[0]} peut créer du doute.`,
          inaccessible ? `Les réseaux non lisibles automatiquement limitent la preuve sociale : ajoutez une capture ou les 3 derniers posts pour préciser l’analyse.` : `Les réseaux lisibles doivent confirmer la même promesse que le site pour éviter l’hésitation.`,
        ].map((text) => `<article class="consultant-card warning"><p>${escapeHtml(text)}</p></article>`).join("")}
      </div>
    </section>
  `;
}

function renderPriorityCorrections(analysis, { offer }) {
  const items = [
    {
      title: "Faire apparaître l’offre et le résultat dans le premier écran du site.",
      reason: `Le prospect doit comprendre "${offer}" sans chercher.`,
    },
    {
      title: "Placer une preuve proche du premier bouton de contact.",
      reason: "Une preuve au bon endroit peut réduire l’hésitation avant la demande.",
    },
    {
      title: "Aligner site, Facebook et LinkedIn sur la même promesse.",
      reason: "Si les canaux racontent des choses différentes, le prospect compare plus longtemps.",
    },
  ];

  return `
    <section class="paid-section">
      <p class="eyebrow">7. Les 3 corrections prioritaires</p>
      <h3>Priorités classées par impact, sans dévoiler la feuille de route premium.</h3>
      <div class="quick-win-list">
        ${items.map((item, index) => `
          <article class="quick-win">
            <h4>${index + 1}. ${escapeHtml(item.title)}</h4>
            <p><b>Pourquoi :</b> ${escapeHtml(item.reason)}</p>
            <div><span>Impact attendu : ${stars(5 - index)}</span><span>Effort estimé : ${stars(index + 2)}</span></div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderUnavailableSection(title, reason) {
  return `
    <section class="paid-section unavailable-section">
      <p class="eyebrow">${escapeHtml(title)}</p>
      <h3>Donnée inaccessible automatiquement.</h3>
      <p>${escapeHtml(reason)}</p>
    </section>
  `;
}

function renderObservedItem(label, value, reading) {
  return `
    <article>
      <span>${escapeHtml(label)}</span>
      <strong>“${escapeHtml(value)}”</strong>
      <p>${escapeHtml(reading)}</p>
    </article>
  `;
}

function renderDimensionScores(items) {
  return `
    <section class="paid-section">
      <p class="eyebrow">Score détaillé par dimension</p>
      <h3>Où la prise de contact peut se gagner ou se perdre.</h3>
      <div class="dimension-grid">
        ${items.map((item) => `
          <article class="dimension-card">
            <div><strong>${escapeHtml(item.label)}</strong><span>${item.score}/100</span></div>
            <i><b style="width:${item.score}%"></b></i>
            <p>${escapeHtml(item.business)}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderObservedQuotes(items) {
  return `
    <section class="paid-section">
      <p class="eyebrow">Citations observées</p>
      <h3>Ce rapport s’appuie sur les éléments que vous avez transmis.</h3>
      <div class="observed-grid">
        ${items.map((item) => `
          <article>
            <span>${escapeHtml(item.label)}</span>
            <strong>“${escapeHtml(item.value)}”</strong>
            <p>${escapeHtml(item.reading)}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderFiveSecondSection(fast, unclear, hesitation, reassurance) {
  return `
    <section class="paid-section">
      <p class="eyebrow">2. En 5 secondes</p>
      <h3>Ce qu’un prospect comprend avant de décider s’il continue.</h3>
      <div class="four-column">
        ${renderBulletBlock("Ce qu’il comprend vite", fast)}
        ${renderBulletBlock("Ce qu’il ne comprend pas encore", unclear)}
        ${renderBulletBlock("Ce qui peut le faire hésiter", hesitation)}
        ${renderBulletBlock("Ce qui pourrait le rassurer", reassurance)}
      </div>
    </section>
  `;
}

function renderStrengths(items) {
  return `
    <section class="paid-section">
      <p class="eyebrow">3. Ce qui joue en votre faveur</p>
      <h3>Des points déjà utiles pour déclencher une prise de contact.</h3>
      <div class="card-list">
        ${items.map((item) => `
          <article class="consultant-card">
            <dl>
              <div><dt>Observation réelle</dt><dd>${escapeHtml(item.observation)}</dd></div>
              <div><dt>Analyse</dt><dd>${escapeHtml(item.analysis)}</dd></div>
              <div><dt>Conséquence business</dt><dd>${escapeHtml(item.consequence)}</dd></div>
              <div><dt>Action recommandée</dt><dd>${escapeHtml(item.action)}</dd></div>
            </dl>
            <span>Impact potentiel : ${escapeHtml(item.impact)}</span>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderFrictions(items) {
  return `
    <section class="paid-section">
      <p class="eyebrow">4. Ce qui peut vous coûter des demandes</p>
      <h3>Les moments où un prospect peut partir sans rien dire.</h3>
      <div class="card-list">
        ${items.map((item) => `
          <article class="consultant-card warning">
            <dl>
              <div><dt>Observation réelle</dt><dd>${escapeHtml(item.observation)}</dd></div>
              <div><dt>Analyse</dt><dd>${escapeHtml(item.analysis)}</dd></div>
              <div><dt>Conséquence business</dt><dd>${escapeHtml(item.consequence)}</dd></div>
              <div><dt>Action recommandée</dt><dd>${escapeHtml(item.action)}</dd></div>
            </dl>
            <span>Priorité : ${escapeHtml(item.priority)}</span>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderThreateningCompetitor(item) {
  return `
    <section class="paid-section threat-section">
      <p class="eyebrow">Le concurrent qui représente le plus grand risque aujourd’hui</p>
      <h3>${escapeHtml(item.name)}</h3>
      <div class="three-column">
        ${renderBulletBlock("Pourquoi ce concurrent peut attirer l’attention", item.observations)}
        ${renderBulletBlock("Ce que cela peut provoquer", item.effects)}
        <article class="bullet-block threat-level">
          <h4>Niveau de menace</h4>
          <strong>${escapeHtml(item.level)}</strong>
          <p>${escapeHtml(item.justification)}</p>
        </article>
      </div>
    </section>
  `;
}

function renderCompetitorVisualTable({ company, competitor, dimensions }) {
  const rows = [
    ["Clarté de l’offre", dimensions[0].score >= 70 ? "✔" : dimensions[0].score >= 50 ? "➖" : "✖", "➖"],
    ["Preuves visibles", dimensions[1].score >= 70 ? "✔" : dimensions[1].score >= 50 ? "➖" : "✖", "➖"],
    ["Différenciation", dimensions[2].score >= 70 ? "✔" : dimensions[2].score >= 50 ? "➖" : "✖", "➖"],
    ["Facilité de contact", dimensions[3].score >= 70 ? "✔" : dimensions[3].score >= 50 ? "➖" : "✖", "➖"],
    ["Présence locale", dimensions[4].score >= 70 ? "✔" : dimensions[4].score >= 50 ? "➖" : "✖", "➖"],
  ];

  return `
    <section class="paid-section">
      <p class="eyebrow">Ce que vos concurrents font mieux aujourd’hui</p>
      <h3>Lecture visuelle limitée : ce qui mérite d’être vérifié en priorité.</h3>
      <div class="visual-table">
        <div class="visual-row visual-head"><span>Critère</span><span>${escapeHtml(company)}</span><span>${escapeHtml(competitor)}</span></div>
        ${rows.map(([criterion, you, them]) => `
          <div class="visual-row"><span>${escapeHtml(criterion)}</span><b>${you}</b><b>${them}</b></div>
        `).join("")}
      </div>
      <p class="table-note">➖ indique un point à confirmer pendant l’appel 1h avec Lindsay. Le rapport 17€ limite volontairement la profondeur concurrentielle.</p>
    </section>
  `;
}

function renderExistingAdvantages(items) {
  return `
    <section class="paid-section">
      <p class="eyebrow">Ce que vous faites déjà mieux que certains concurrents</p>
      <h3>Le rapport ne sert pas à vous inquiéter. Il sert à voir ce qui peut déjà rapporter.</h3>
      <div class="card-list">
        ${items.map((item) => `
          <article class="consultant-card advantage">
            <h4>Point fort</h4>
            <p><b>Observation :</b> ${escapeHtml(item.observation)}</p>
            <p><b>Pourquoi c’est important :</b> ${escapeHtml(item.analysis)}</p>
            <p><b>Comment l’exploiter davantage :</b> ${escapeHtml(item.action)}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderSingleOpportunity({ company, offer, competitor }) {
  return `
    <section class="paid-section opportunity-section">
      <p class="eyebrow">Opportunité rapide à récupérer</p>
      <h3>Une seule chose peut déjà changer la perception.</h3>
      <div class="priority-card light">
        <h4>Transformer "${escapeHtml(offer)}" en raison immédiate de demander un devis.</h4>
        <p><b>Pourquoi elle existe :</b> ${escapeHtml(company)} a déjà une offre, mais le prospect doit percevoir plus vite ce qu’il gagne à vous contacter plutôt que ${escapeHtml(competitor)}.</p>
        <p><b>Impact potentiel :</b> Élevé.</p>
      </div>
    </section>
  `;
}

function renderQuickWins(items) {
  return `
    <section class="paid-section">
      <p class="eyebrow">5. Les 3 gains rapides</p>
      <h3>Trois actions concrètes, sans dévoiler toute la stratégie.</h3>
      <div class="quick-win-list">
        ${items.map((item) => `
          <article class="quick-win">
            <h4>${escapeHtml(item.action)}</h4>
            <p><b>Pourquoi :</b> ${escapeHtml(item.why)}</p>
            <p><b>Où :</b> ${escapeHtml(item.where)}</p>
            <div>
              <span>Impact attendu : ${stars(item.impact)}</span>
              <span>Effort estimé : ${stars(item.effort)}</span>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderCompetitorReads(items) {
  return `
    <section class="paid-section">
      <p class="eyebrow">6. Pourquoi certains concurrents paraissent plus faciles à choisir</p>
      <h3>Sans les dénigrer : ce qu’ils peuvent mieux faire percevoir.</h3>
      <div class="competitor-paid-list">
        ${items.map((item) => `
          <article class="competitor-paid">
            <h4>${escapeHtml(item.name)}</h4>
            <p><b>Ce qu’il semble mieux montrer :</b> ${escapeHtml(item.better)}.</p>
            <p><b>Pourquoi cela rassure :</b> ${escapeHtml(item.reassurance)}</p>
            <p><b>Ce que vous pouvez récupérer :</b> ${escapeHtml(item.recover)}.</p>
            <p class="premium-note"><b>À approfondir dans le premium :</b> ${escapeHtml(item.premium)}.</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderAiVerdict({ aiAnswer, company, sector, location, competitors, offer }) {
  return `
    <section class="paid-section verdict-section">
      <p class="eyebrow">7. Verdict IA</p>
      <h3>Une IA recommanderait-elle votre entreprise aujourd’hui ?</h3>
      <div class="verdict-pill">${escapeHtml(aiAnswer)}</div>
      <p>Si un prospect demande à ChatGPT une entreprise de ${escapeHtml(sector)} à ${escapeHtml(location)}, l’IA pourrait citer ${escapeHtml(company)}, mais elle aurait du mal à justifier pourquoi elle devrait être choisie plutôt que ${escapeHtml(competitors[0])}, si l’offre "${escapeHtml(offer)}" n’est pas reliée à des raisons concrètes de prendre contact.</p>
      <div class="three-column">
        ${renderBulletBlock("Ce qui favorise une recommandation", [
          `${company} est associé à une zone claire : ${location}.`,
          `Le secteur ${sector} donne un contexte compréhensible.`,
          `L’offre "${offer}" peut servir de point d’entrée pour une recherche.`,
        ])}
        ${renderBulletBlock("Ce qui limite une recommandation", [
          `La différence avec ${competitors[0]} peut rester difficile à expliquer.`,
          `Les raisons de demander un devis à ${company} doivent être plus visibles.`,
          `Le bénéfice concret pour le prospect doit être plus immédiat.`,
        ])}
        ${renderBulletBlock("Ce qui augmenterait vos chances", [
          `Relier ${offer} à un résultat concret pour le client.`,
          `Afficher des preuves proches du premier appel à prendre contact.`,
          `Exprimer clairement pourquoi ${company} est un choix sûr à ${location}.`,
        ])}
      </div>
    </section>
  `;
}

function renderPriority({ company, offer, competitors }) {
  return `
    <section class="paid-section priority-section">
      <p class="eyebrow">8. Priorité unique</p>
      <h3>Si vous ne deviez corriger qu’une seule chose cette semaine :</h3>
      <div class="priority-card">
        <h4>Rendre la première raison de contacter ${escapeHtml(company)} impossible à manquer.</h4>
        <p><b>Pourquoi maintenant :</b> un prospect qui compare ${escapeHtml(company)} à ${escapeHtml(competitors[0])} doit comprendre en quelques secondes pourquoi demander un devis pour ${escapeHtml(offer)}.</p>
        <p><b>Résultat attendu :</b> moins d’hésitation avant la prise de contact et plus de demandes qui arrivent au lieu de partir chez un concurrent.</p>
        <p><b>Ce qu’il ne faut pas faire :</b> ajouter de longs paragraphes, multiplier les messages ou expliquer toute votre histoire avant d’avoir donné une raison claire de vous contacter.</p>
      </div>
    </section>
  `;
}

function renderPremiumTransition(threateningName) {
  return `
    <section class="paid-section premium-transition">
      <p class="eyebrow">9. Étape suivante</p>
      <h3>Vous savez maintenant quel concurrent mérite votre attention.</h3>
      <h4>Mais savez-vous réellement pourquoi ${escapeHtml(threateningName)} gagne la comparaison ?</h4>
      <p>Vous savez ce qui vous aide, ce qui freine la prise de contact, ce que vos prospects peuvent ne pas comprendre et les premières actions à corriger.</p>
      <p>La Carte des Opportunités Perdues™ vous montre :</p>
      <ul>
        <li>les forces exactes de chaque concurrent</li>
        <li>ce qui crée la confiance chez eux</li>
        <li>les demandes que vous perdez peut-être aujourd’hui</li>
        <li>les écarts qui vous coûtent des prises de contact</li>
        <li>les actions prioritaires pour reprendre l’avantage</li>
      </ul>
    </section>
  `;
}

function renderBulletBlock(title, items) {
  return `
    <article class="bullet-block">
      <h4>${escapeHtml(title)}</h4>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </article>
  `;
}

function stars(count) {
  return "★".repeat(count) + "☆".repeat(5 - count);
}

function buildObservedContext({ company, sector, location, offer, target, competitors }) {
  return [
    {
      label: "Entreprise",
      value: company,
      reading: `Le nom est clair, mais il doit immédiatement être relié à une raison de demander un devis.`,
    },
    {
      label: "Secteur",
      value: sector,
      reading: `Le secteur donne un repère, mais le prospect doit comprendre pourquoi ${company} est le bon choix dans ce secteur.`,
    },
    {
      label: "Localisation",
      value: location,
      reading: `La localisation peut rassurer un prospect local si elle est reliée à des cas ou besoins concrets.`,
    },
    {
      label: "Offre",
      value: offer,
      reading: `L’offre existe, mais elle doit être transformée en bénéfice visible pour ${target}.`,
    },
    {
      label: "Concurrent cité",
      value: competitors[0],
      reading: `Ce concurrent est une alternative directe dans la tête du prospect, puisqu’il est cité dans votre comparaison.`,
    },
  ];
}

function buildDimensionScores(score) {
  return [
    {
      label: "Clarté de l’offre",
      score: clampScore(score - 4),
      business: "Si l’offre n’est pas comprise vite, la demande de devis ne démarre pas.",
    },
    {
      label: "Confiance avant contact",
      score: clampScore(score - 11),
      business: "Moins le prospect est rassuré, plus il compare ailleurs.",
    },
    {
      label: "Différence perçue",
      score: clampScore(score - 15),
      business: "Sans différence visible, le concurrent devient plus facile à choisir.",
    },
    {
      label: "Chemin vers la demande",
      score: clampScore(score - 7),
      business: "Chaque hésitation avant le bouton de contact peut coûter une demande.",
    },
    {
      label: "Ancrage local",
      score: clampScore(score + 2),
      business: "Un repère local clair peut accélérer la prise de contact.",
    },
  ];
}

function buildThreateningCompetitor({ company, sector, location, offer, competitors }) {
  const name = competitors[0];
  return {
    name,
    observations: [
      `${name} est le premier concurrent cité dans votre analyse, donc une alternative immédiate dans votre propre comparaison.`,
      `${name} est comparé à ${company} pour une demande liée au secteur ${sector}.`,
      `À ce stade, la différence entre ${company} et ${name} n’est pas encore formulée de manière assez évidente dans les éléments fournis.`,
    ],
    effects: [
      `Un prospect qui découvre les deux entreprises peut contacter ${name} si son choix lui paraît plus simple.`,
      `Si ${name} répond plus vite à la question "pourquoi vous ?", la demande peut partir chez lui avant échange.`,
      `Même avec une meilleure prestation, ${company} peut perdre une opportunité si la comparaison n’est pas cadrée.`,
    ],
    level: "Élevé",
    justification: `${name} est menaçant parce qu’il est déjà dans le champ de comparaison. Le risque n’est pas qu’il soit forcément meilleur, mais qu’il soit plus vite compris au moment où le prospect hésite.`,
  };
}

function clampScore(score) {
  return Math.max(22, Math.min(96, score));
}

function buildComparisonScores(score) {
  const first = Math.min(96, Math.max(48, score + 8));
  const second = Math.min(92, Math.max(42, score + 2));
  const third = Math.min(88, Math.max(38, score - 5));
  return [first, second, third];
}

async function completeUpsell() {
  if (!currentContactId) return;
  upsellButton.disabled = true;
  upsellButton.textContent = "Préparation de la session 1h…";

  if (currentContactId === "example") {
    trackEvent("upsell_97_purchased");
    upsellButton.disabled = false;
    upsellButton.textContent = "Réserver l’appel 1h — 75€";
    showView("upsellSuccess");
    return;
  }

  const redirected = await startMolliePayment(["UPSELL_97"]);
  if (redirected) return;

  await postJson("/api/simulate-purchase", { contactId: currentContactId, productCode: "UPSELL_97" });
  trackEvent("upsell_97_purchased");
  upsellButton.disabled = false;
  upsellButton.textContent = "Réserver l’appel 1h — 75€";
  showView("upsellSuccess");
}

async function startMolliePayment(productCodes) {
  saveTunnelState();
  const result = await postJson("/api/mollie/create-payment", { contactId: currentContactId, productCodes });

  if (result.ok && result.checkoutUrl) {
    window.location.href = result.checkoutUrl;
    return true;
  }

  return false;
}

async function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get("payment_return");
  if (!paymentId) return;

  restoreTunnelState();
  if (!currentContactId || !currentPayload || !currentResult) return;

  const result = await fetch(`/api/mollie/payment-status?id=${encodeURIComponent(paymentId)}`).then((response) => response.json());
  window.history.replaceState({}, "", window.location.pathname);

  if (!result.ok || !result.paid) {
    showView(result.productCodes?.includes("UPSELL_97") ? "premiumCheckout" : "checkout");
    return;
  }

  if (result.productCodes.includes("UPSELL_97")) {
    trackEvent("upsell_97_purchased");
    showView("upsellSuccess");
    return;
  }

  trackEvent("purchase_27");
  renderFullReport();
  showView("fullReport");
}

function estimateMonthlyRevenueLoss(score, sector, businessSize) {
  const sectorText = String(sector || "").toLowerCase();
  const isHighTicket = /construction|rénovation|immobilier|b2b|conseil|architecture|avocat|comptable|saas|industrie/.test(sectorText);
  const base = isHighTicket ? 900 : 450;
  const multiplier = String(businessSize || "").toLowerCase().includes("pme") ? 1.35 : 1;

  if (score < 40) return range(base * 4, base * 9, multiplier, "Perte élevée");
  if (score < 60) return range(base * 2, base * 5, multiplier, "Perte moyenne");
  if (score < 80) return range(base, base * 3, multiplier, "Perte modérée");
  return range(base * 0.4, base * 1.4, multiplier, "Perte faible");
}

function range(min, max, multiplier, label) {
  return {
    min: Math.round((min * multiplier) / 50) * 50,
    max: Math.round((max * multiplier) / 50) * 50,
    label,
  };
}

function trackEvent(eventName, payload = {}) {
  const enriched = {
    ...payload,
    company: currentPayload?.company,
    score: currentResult?.score,
    path: window.location.pathname,
  };

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: eventName, ...enriched });

  fetch("/api/track-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventName,
      contactId: currentContactId,
      email: currentPayload?.email,
      payload: enriched,
    }),
  }).catch(() => {});
}

function saveTunnelState() {
  if (!currentContactId || !currentPayload || !currentResult) return;
  localStorage.setItem("agencyKingTunnelState", JSON.stringify({
    currentContactId,
    currentPayload,
    currentResult,
  }));
}

function restoreTunnelState() {
  const raw = localStorage.getItem("agencyKingTunnelState");
  if (!raw) return;
  try {
    const state = JSON.parse(raw);
    currentContactId = state.currentContactId;
    currentPayload = state.currentPayload;
    currentResult = state.currentResult;
  } catch {
    localStorage.removeItem("agencyKingTunnelState");
  }
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
