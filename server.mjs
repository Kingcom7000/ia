import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  BrevoCommercialMachine,
  runCheckupStartedWorkflow,
  runCheckupCompletedWorkflow,
  runPurchaseWorkflow,
  runCommercialEventWorkflow,
} from "./src/brevo-commercial-machine.ts";

const ROOT = process.cwd();
const PUBLIC_DIR = join(ROOT, "public");
const DATA_DIR = join(ROOT, "data");
const DB_FILE = join(DATA_DIR, "test-db.json");
const abandonedCheckoutTimers = new Map();
let dbWriteQueue = Promise.resolve();

loadLocalEnv();

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "0.0.0.0";

const brevo = process.env.BREVO_API_KEY
  ? new BrevoCommercialMachine({
      apiKey: process.env.BREVO_API_KEY,
      trackerKey: process.env.BREVO_TRACKER_KEY,
      senderEmail: process.env.BREVO_SENDER_EMAIL ?? "contact@agency-king.com",
      senderName: process.env.BREVO_SENDER_NAME ?? "Agency King",
    })
  : null;

let listIds = {
  "Leads Check-Up": numberEnv("BREVO_LIST_LEADS_CHECKUP_ID"),
  "Clients 27€": numberEnv("BREVO_LIST_CLIENTS_27_ID"),
  "Clients Décodeur": numberEnv("BREVO_LIST_CLIENTS_DECODEUR_ID"),
  "Clients 97€": numberEnv("BREVO_LIST_CLIENTS_97_ID"),
  "Clients Session Stratégique": numberEnv("BREVO_LIST_CLIENTS_SESSION_ID"),
  "Clients Accompagnement": numberEnv("BREVO_LIST_CLIENTS_ACCOMPAGNEMENT_ID"),
};

listIds = await resolveBrevoLists(listIds);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") return serveFile(res, "index.html");
    if (req.method === "GET" && url.pathname === "/admin") return serveFile(res, "admin.html");
    if (req.method === "GET" && url.pathname === "/session-strategique") return serveFile(res, "session-strategique.html");
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      return serveFile(res, url.pathname.replace(/^\//, ""));
    }

    if (req.method === "POST" && url.pathname === "/api/checkup") {
      return json(res, await handleCheckup(await readJson(req)));
    }

    if (req.method === "POST" && url.pathname === "/api/track-event") {
      return json(res, await handleTrackEvent(await readJson(req)));
    }

    if (req.method === "POST" && url.pathname === "/api/simulate-purchase") {
      return json(res, await handlePurchase(await readJson(req)));
    }

    if (req.method === "POST" && url.pathname === "/api/mollie/create-payment") {
      return json(res, await handleCreateMolliePayment(await readJson(req), req));
    }

    if (req.method === "POST" && url.pathname === "/api/mollie/webhook") {
      return json(res, await handleMollieWebhook(await readForm(req)));
    }

    if (req.method === "GET" && url.pathname === "/api/mollie/payment-status") {
      return json(res, await handleMolliePaymentStatus(url.searchParams.get("id")));
    }

    if (req.method === "POST" && url.pathname === "/api/brevo/campaign") {
      return json(res, await handleCreateCampaign(await readJson(req)));
    }

    if (req.method === "POST" && url.pathname === "/api/commercial-event") {
      return json(res, await handleCommercialEvent(await readJson(req)));
    }

    if (req.method === "POST" && url.pathname === "/api/calendly/webhook") {
      return json(res, await handleCalendlyWebhook(await readJson(req)));
    }

    if (req.method === "GET" && url.pathname === "/api/admin/metrics") {
      return json(res, await adminMetrics());
    }

    return notFound(res);
  } catch (error) {
    console.error(error);
    return json(res, { ok: false, error: error instanceof Error ? error.message : "Erreur serveur" }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Tunnel test Agency King: http://${HOST}:${PORT}`);
  if (!brevo) console.log("BREVO_API_KEY absente: synchro Brevo désactivée en mode local.");
});

async function handleCheckup(input) {
  const db = await readDb();
  const now = new Date().toISOString();
  const contactId = randomUUID();
  const diagnosticId = randomUUID();
  const digitalAnalysis = await analyzeDigitalPresence(input);
  const score = digitalAnalysis.score.global;
  const maturity = maturityFromScore(score);
  const risk = riskFromScore(score);
  const reportUrl = `http://localhost:${PORT}/#rapport-${diagnosticId}`;
  const contact = toBrevoContact(input, { score, maturity, risk, reportUrl });

  db.contacts.push({ id: contactId, ...input, createdAt: now });
  db.diagnostics.push({
    id: diagnosticId,
    contactId,
    score,
    maturity,
    risk,
    analysis: digitalAnalysis,
    reportUrl,
    status: "completed",
    createdAt: now,
    completedAt: now,
  });
  db.events.push({ id: randomUUID(), contactId, diagnosticId, eventName: "CHECKUP_STARTED", createdAt: now });
  db.events.push({ id: randomUUID(), contactId, diagnosticId, eventName: "CHECKUP_COMPLETED", createdAt: now });

  const brevoSync = await syncBrevo(async () => {
    if (!brevo) throw new Error("BREVO_API_KEY absente");
    await runCheckupStartedWorkflow({ machine: brevo, contact, lists: listIds });
    await runCheckupCompletedWorkflow({
      machine: brevo,
      contact,
      lists: listIds,
      decoderUrl: `http://localhost:${PORT}/#decoder`,
    });
  });

  db.brevoLogs.push({
    id: randomUUID(),
    contactId,
    diagnosticId,
    action: "checkup_completed",
    ok: brevoSync.ok,
    message: brevoSync.message,
    createdAt: now,
  });

  await writeDb(db);

  return {
    ok: true,
    contactId,
    diagnosticId,
    score,
    maturity,
    risk,
    analysis: digitalAnalysis,
    reportUrl,
    brevo: brevoSync,
    summary: buildSummary(input, score, maturity, risk),
  };
}

async function handlePurchase(input) {
  const db = await readDb();
  const now = new Date().toISOString();
  const contactRow = db.contacts.find((contact) => contact.id === input.contactId);
  const diagnostic = db.diagnostics.find((item) => item.contactId === input.contactId);

  if (!contactRow || !diagnostic) throw new Error("Analyse introuvable");

  const product = productFromCode(input.productCode);
  const contact = toBrevoContact(contactRow, {
    score: diagnostic.score,
    maturity: diagnostic.maturity,
    risk: diagnostic.risk,
    reportUrl: diagnostic.reportUrl,
  });

  db.purchases.push({
    id: randomUUID(),
    contactId: input.contactId,
    diagnosticId: diagnostic.id,
    productCode: input.productCode,
    productName: product.name,
    amountCents: product.amountCents,
    status: input.productCode === "ACCOMPAGNEMENT" ? "active" : "paid",
    simulated: true,
    createdAt: now,
  });
  db.events.push({
    id: randomUUID(),
    contactId: input.contactId,
    diagnosticId: diagnostic.id,
    eventName: input.productCode,
    createdAt: now,
  });

  const brevoSync = await syncBrevo(async () => {
    if (!brevo) throw new Error("BREVO_API_KEY absente");
    await runPurchaseWorkflow({ machine: brevo, contact, lists: listIds, purchase: input.productCode });
  });

  db.brevoLogs.push({
    id: randomUUID(),
    contactId: input.contactId,
    diagnosticId: diagnostic.id,
    action: input.productCode,
    ok: brevoSync.ok,
    message: brevoSync.message,
    createdAt: now,
  });

  await writeDb(db);

  return {
    ok: true,
    product,
    brevo: brevoSync,
    showCalendly: input.productCode === "UPSELL_97" || input.productCode === "CALL_297",
    calendlyUrl: process.env.CALENDLY_EVENT_URL || "https://calendly.com/",
  };
}

async function handleTrackEvent(input) {
  const db = await readDb();
  const now = new Date().toISOString();
  const allowed = new Set([
    "page_view_sales",
    "checkout_started",
    "order_bump_accepted",
    "purchase_27",
    "upsell_97_viewed",
    "upsell_97_purchased",
    "arthur_offer_viewed",
    "arthur_trial_started",
    "call_option_selected",
    "abandoned_checkout",
  ]);
  const eventName = input.eventName;
  if (!allowed.has(eventName)) throw new Error("Événement analytics non autorisé");

  db.analyticsEvents.push({
    id: randomUUID(),
    eventName,
    contactId: input.contactId,
    payload: input.payload ?? {},
    createdAt: now,
  });

  if (eventName === "checkout_started" && input.contactId) {
    scheduleAbandonedCheckout(input.contactId);
  }

  if (brevo && input.email) {
    await syncBrevo(() => brevo.trackEvent(eventName, input.email, input.payload ?? {}));
  }

  await writeDb(db);
  return { ok: true };
}

function scheduleAbandonedCheckout(contactId) {
  if (abandonedCheckoutTimers.has(contactId)) clearTimeout(abandonedCheckoutTimers.get(contactId));
  const timer = setTimeout(() => sendAbandonedCheckoutIfNeeded(contactId), 60 * 60 * 1000);
  abandonedCheckoutTimers.set(contactId, timer);
}

async function sendAbandonedCheckoutIfNeeded(contactId) {
  const db = await readDb();
  const contact = db.contacts.find((item) => item.id === contactId);
  const diagnostic = db.diagnostics.find((item) => item.contactId === contactId);
  const hasPaid27 = db.purchases.some((purchase) => purchase.contactId === contactId && purchase.productCode === "CHECKUP_27" && purchase.status === "paid");
  const alreadySent = db.analyticsEvents.some((event) => event.contactId === contactId && event.eventName === "abandoned_checkout");

  if (!contact || !diagnostic || hasPaid27 || alreadySent) return;

  db.analyticsEvents.push({
    id: randomUUID(),
    eventName: "abandoned_checkout",
    contactId,
    payload: { score: diagnostic.score, company: contact.company },
    createdAt: new Date().toISOString(),
  });

  if (brevo) {
    await syncBrevo(() => brevo.sendAbandonedCheckoutEmail({
      email: contact.email,
      company: contact.company,
      score: diagnostic.score,
      checkoutUrl: `${process.env.APP_BASE_URL || `http://127.0.0.1:${PORT}`}/?resume_checkout=${contactId}`,
    }));
  }

  await writeDb(db);
}

async function handleCreateMolliePayment(input, req) {
  const db = await readDb();
  const now = new Date().toISOString();
  const contactRow = db.contacts.find((contact) => contact.id === input.contactId);
  const diagnostic = db.diagnostics.find((item) => item.contactId === input.contactId);

  if (!contactRow || !diagnostic) throw new Error("Analyse introuvable");

  const productCodes = normalizeProductCodes(input.productCodes);
  const products = productCodes.map(productFromCode);
  const totalCents = products.reduce((sum, product) => sum + product.amountCents, 0);
  const localPaymentId = randomUUID();
  const baseUrl = publicBaseUrl(req);

  if (!process.env.MOLLIE_API_KEY) {
    return {
      ok: false,
      fallback: true,
      message: "MOLLIE_API_KEY absente. Paiement Mollie non créé.",
    };
  }

  const payment = await mollieRequest("/payments", {
    method: "POST",
    body: {
      amount: {
        currency: "EUR",
        value: formatEuro(totalCents),
      },
      description: products.map((product) => product.name).join(" + "),
      redirectUrl: `${baseUrl}/?payment_return=${localPaymentId}`,
      webhookUrl: `${baseUrl}/api/mollie/webhook`,
      metadata: {
        localPaymentId,
        contactId: input.contactId,
        diagnosticId: diagnostic.id,
        productCodes,
      },
    },
  });

  db.molliePayments.push({
    id: localPaymentId,
    molliePaymentId: payment.id,
    contactId: input.contactId,
    diagnosticId: diagnostic.id,
    productCodes,
    amountCents: totalCents,
    status: payment.status,
    checkoutUrl: payment._links?.checkout?.href,
    createdAt: now,
    updatedAt: now,
  });

  await writeDb(db);

  return {
    ok: true,
    paymentId: localPaymentId,
    molliePaymentId: payment.id,
    checkoutUrl: payment._links?.checkout?.href,
  };
}

async function handleMollieWebhook(input) {
  const molliePaymentId = input.id;
  if (!molliePaymentId) return { ok: false, message: "Payment id manquant" };

  const payment = await mollieRequest(`/payments/${encodeURIComponent(molliePaymentId)}`, { method: "GET" });
  const db = await readDb();
  const record = db.molliePayments.find((item) => item.molliePaymentId === molliePaymentId);

  if (!record) return { ok: true, message: "Paiement inconnu localement" };

  record.status = payment.status;
  record.updatedAt = new Date().toISOString();

  if (payment.status === "paid" && !record.processedAt) {
    await recordPaidMollieProducts(db, record, molliePaymentId);
    record.processedAt = new Date().toISOString();
  }

  await writeDb(db);
  return { ok: true };
}

async function handleMolliePaymentStatus(localPaymentId) {
  if (!localPaymentId) throw new Error("Identifiant paiement manquant");

  const db = await readDb();
  const record = db.molliePayments.find((item) => item.id === localPaymentId);
  if (!record) throw new Error("Paiement introuvable");

  if (process.env.MOLLIE_API_KEY && record.molliePaymentId) {
    const payment = await mollieRequest(`/payments/${encodeURIComponent(record.molliePaymentId)}`, { method: "GET" });
    record.status = payment.status;
    record.updatedAt = new Date().toISOString();

    if (payment.status === "paid" && !record.processedAt) {
      await recordPaidMollieProducts(db, record, record.molliePaymentId);
      record.processedAt = new Date().toISOString();
    }

    await writeDb(db);
  }

  return {
    ok: true,
    status: record.status,
    paid: record.status === "paid",
    productCodes: record.productCodes,
    contactId: record.contactId,
  };
}

async function recordPaidMollieProducts(db, paymentRecord, molliePaymentId) {
  for (const productCode of paymentRecord.productCodes) {
    await recordPaidPurchaseFromMollie(db, paymentRecord, productCode, molliePaymentId);
  }
}

async function recordPaidPurchaseFromMollie(db, paymentRecord, productCode, molliePaymentId) {
  const now = new Date().toISOString();
  const paymentProviderId = `${molliePaymentId}:${productCode}`;
  const alreadyRecorded = db.purchases.some((purchase) => purchase.paymentProviderId === paymentProviderId);

  if (alreadyRecorded) return;

  const product = productFromCode(productCode);
  db.purchases.push({
    id: randomUUID(),
    contactId: paymentRecord.contactId,
    diagnosticId: paymentRecord.diagnosticId,
    productCode,
    productName: product.name,
    amountCents: product.amountCents,
    currency: "EUR",
    paymentProvider: "mollie",
    paymentProviderId,
    status: "paid",
    simulated: false,
    createdAt: now,
  });
  db.events.push({
    id: randomUUID(),
    contactId: paymentRecord.contactId,
    diagnosticId: paymentRecord.diagnosticId,
    eventName: productCode,
    createdAt: now,
  });

  const contactRow = db.contacts.find((contact) => contact.id === paymentRecord.contactId);
  const diagnostic = db.diagnostics.find((item) => item.id === paymentRecord.diagnosticId);

  if (!contactRow || !diagnostic) return;

  const brevoSync = await syncBrevo(async () => {
    if (!brevo) throw new Error("BREVO_API_KEY absente");
    await runPurchaseWorkflow({
      machine: brevo,
      contact: toBrevoContact(contactRow, {
        score: diagnostic.score,
        maturity: diagnostic.maturity,
        risk: diagnostic.risk,
        reportUrl: diagnostic.reportUrl,
      }),
      lists: listIds,
      purchase: productCode,
    });
  });

  db.brevoLogs.push({
    id: randomUUID(),
    contactId: paymentRecord.contactId,
    diagnosticId: paymentRecord.diagnosticId,
    action: productCode,
    ok: brevoSync.ok,
    message: brevoSync.message,
    createdAt: now,
  });
}

async function handleCreateCampaign(input) {
  const db = await readDb();
  const now = new Date().toISOString();

  if (!brevo) {
    const result = { ok: false, message: "BREVO_API_KEY absente" };
    db.brevoLogs.push({
      id: randomUUID(),
      action: "create_email_campaign",
      ok: false,
      message: result.message,
      createdAt: now,
    });
    await writeDb(db);
    return result;
  }

  const selectedListIds = parseListIds(input.listIds);
  if (!selectedListIds.length) throw new Error("Ajoutez au moins un ID de liste Brevo.");

  const campaign = await brevo.createEmailCampaign({
    name: input.name || "Campaign sent via the API",
    subject: input.subject || "Votre score est prêt.",
    sender: {
      name: input.senderName || process.env.BREVO_SENDER_NAME || "Agency King",
      email: input.senderEmail || process.env.BREVO_SENDER_EMAIL || "contact@agency-king.com",
    },
    htmlContent:
      input.htmlContent ||
      "<p>Congratulations! You successfully created this example campaign via the Brevo API.</p>",
    listIds: selectedListIds,
    scheduledAt: input.scheduledAt || undefined,
    previewText: input.previewText || undefined,
    tag: "agency-king-test",
  });

  db.campaigns.push({
    id: randomUUID(),
    brevoCampaignId: campaign.id,
    name: input.name,
    subject: input.subject,
    listIds: selectedListIds,
    scheduledAt: input.scheduledAt || null,
    createdAt: now,
  });
  db.brevoLogs.push({
    id: randomUUID(),
    action: "create_email_campaign",
    ok: true,
    message: `Campagne Brevo créée: #${campaign.id}`,
    createdAt: now,
  });

  await writeDb(db);
  return { ok: true, campaignId: campaign.id, message: `Campagne Brevo créée: #${campaign.id}` };
}

async function handleCommercialEvent(input) {
  const db = await readDb();
  const now = new Date().toISOString();
  const allowed = new Set(["RDV_INTERESSE", "RDV_RESERVE"]);
  if (!allowed.has(input.eventName)) throw new Error("Événement non autorisé");

  const contactRow = db.contacts.find((contact) => contact.id === input.contactId);
  const diagnostic = contactRow ? db.diagnostics.find((item) => item.contactId === contactRow.id) : null;

  db.events.push({
    id: randomUUID(),
    contactId: contactRow?.id,
    diagnosticId: diagnostic?.id,
    eventName: input.eventName,
    payload: input.payload ?? {},
    createdAt: now,
  });

  const brevoSync = await syncBrevo(async () => {
    if (!brevo) throw new Error("BREVO_API_KEY absente");
    if (!contactRow || !diagnostic) return;
    await runCommercialEventWorkflow({
      machine: brevo,
      event: input.eventName,
      contact: toBrevoContact(contactRow, {
        score: diagnostic.score,
        maturity: diagnostic.maturity,
        risk: diagnostic.risk,
        reportUrl: diagnostic.reportUrl,
      }),
    });
  });

  db.brevoLogs.push({
    id: randomUUID(),
    contactId: contactRow?.id,
    diagnosticId: diagnostic?.id,
    action: input.eventName,
    ok: brevoSync.ok,
    message: brevoSync.message,
    createdAt: now,
  });

  await writeDb(db);
  return { ok: true, brevo: brevoSync };
}

async function handleCalendlyWebhook(input) {
  const email = input?.payload?.email || input?.payload?.invitee?.email || input?.email;
  const db = await readDb();
  const contact = email ? db.contacts.find((item) => item.email === email) : db.contacts.at(-1);

  return handleCommercialEvent({
    contactId: contact?.id,
    eventName: "RDV_RESERVE",
    payload: input,
  });
}


async function adminMetrics() {
  const db = await readDb();
  const countEvents = (name) => db.events.filter((event) => event.eventName === name).length;
  const countPurchases = (code) => db.purchases.filter((purchase) => purchase.productCode === code).length;
  const completed = countEvents("CHECKUP_COMPLETED");
  const started = countEvents("CHECKUP_STARTED");
  const sales27 = countPurchases("CHECKUP_27");
  const bumps = countPurchases("BUMP_17");
  const sales97 = countPurchases("UPSELL_97");
  const rdvInterested = countEvents("RDV_INTERESSE");
  const rdvReserved = countEvents("RDV_RESERVE");
  const brevoErrors = db.brevoLogs.filter((log) => !log.ok).length;

  return {
    ok: true,
    testMode: process.env.VITE_PUBLIC_TEST_MODE === "true",
    metrics: {
      diagnosticsStarted: started,
      diagnosticsCompleted: completed,
      sales27,
      bumps17: bumps,
      sales97,
      rdvInterested,
      rdvReserved,
      bookings: rdvReserved,
      brevoErrors,
      conversionCompleted: ratio(completed, started),
      conversion27: ratio(sales27, completed),
      conversionBump: ratio(bumps, sales27),
      conversion97: ratio(sales97, sales27),
    },
    diagnostics: db.diagnostics.slice(-20).reverse().map((diagnostic) => ({
      ...diagnostic,
      contact: db.contacts.find((contact) => contact.id === diagnostic.contactId),
    })),
    purchases: db.purchases.slice(-20).reverse(),
    campaigns: db.campaigns.slice(-20).reverse(),
    contacts: db.contacts.slice(-20).reverse(),
    brevoLogs: db.brevoLogs.slice(-20).reverse(),
  };
}

function toBrevoContact(input, analysis) {
  return {
    email: input.email,
    company: input.company,
    sector: input.sector,
    location: input.location,
    website: input.website,
    facebook: input.facebook,
    linkedin: input.linkedin,
    googleBusiness: input.googleBusiness,
    mainOffer: input.mainOffer,
    targetClient: input.targetClient,
    commercialMessage: input.commercialMessage,
    mainObjective: input.mainObjective,
    competitors: [input.competitor1, input.competitor2, input.competitor3],
    score: analysis.score,
    maturity: analysis.maturity,
    risk: analysis.risk,
    reportUrl: analysis.reportUrl,
  };
}

async function analyzeDigitalPresence(input) {
  const [website, facebook, linkedin, competitors] = await Promise.all([
    analyzeWebsite(input.website, input),
    analyzeSocial("facebook", input.facebook, input),
    analyzeSocial("linkedin", input.linkedin, input),
    analyzeCompetitorWebsites(input),
  ]);
  const coherence = analyzeCoherence(input, website, facebook, linkedin);
  const positioning = analyzePositioning(input, website, competitors);
  const score = calculateDigitalScore(input, website, facebook, linkedin, coherence);

  return {
    score,
    website,
    facebook,
    linkedin,
    competitors,
    positioning,
    coherence,
    generatedAt: new Date().toISOString(),
  };
}

async function analyzeCompetitorWebsites(input) {
  const competitors = [input.competitor1, input.competitor2, input.competitor3].filter(Boolean);
  return Promise.all(competitors.map(async (competitor, index) => {
    if (!looksLikeUrl(competitor)) {
      return {
        name: competitor,
        rank: index + 1,
        accessible: false,
        reason: "Nom fourni sans URL : comparaison textuelle à confirmer pendant l’échange avec Lindsay.",
      };
    }

    const analysis = await analyzeWebsite(competitor, input);
    return {
      name: competitor,
      rank: index + 1,
      accessible: analysis.accessible,
      reason: analysis.reason,
      url: analysis.url,
      title: analysis.title,
      metaDescription: analysis.metaDescription,
      h1: analysis.h1,
      ctas: analysis.ctas,
      textSample: analysis.textSample,
      clarity: analysis.clarity,
      trust: analysis.trust,
      conversion: analysis.conversion,
      observations: analysis.accessible
        ? [
          analysis.title ? `Title concurrent lu : "${analysis.title}".` : "Title concurrent non lisible.",
          analysis.h1?.length ? `H1 concurrent lu : "${analysis.h1[0]}".` : "H1 concurrent non lisible.",
          analysis.ctas?.length ? `Appels à l’action concurrents repérés : ${analysis.ctas.slice(0, 3).join(", ")}.` : "Aucun appel à l’action concurrent évident n’a été repéré.",
        ]
        : [analysis.reason],
    };
  }));
}

async function analyzeWebsite(url, input) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return inaccessibleAnalysis("website", "Aucune URL de site web fournie.");
  }

  const fetched = await fetchHtml(normalizedUrl);
  if (!fetched.ok) {
    return inaccessibleAnalysis("website", `Le site n’a pas pu être lu automatiquement : ${fetched.reason}`);
  }

  const html = fetched.html;
  const title = cleanText(extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const metaDescription = cleanText(extractFirst(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    || extractFirst(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i));
  const h1 = extractTags(html, "h1", 3);
  const h2 = extractTags(html, "h2", 8);
  const links = extractLinks(html);
  const bodyText = cleanText(stripHtml(html)).slice(0, 6000);
  const lowerText = bodyText.toLowerCase();
  const ctas = extractCtas(links, bodyText);
  const visibleKeywords = extractVisibleKeywords(bodyText, input);
  const proofTerms = findTerms(lowerText, ["témoignage", "avis", "client", "cas client", "réalisation", "projet", "référence", "certifié", "garantie", "résultat"]);
  const contactTerms = findTerms(lowerText, ["contact", "devis", "appel", "rendez-vous", "rdv", "téléphone", "email", "formulaire"]);

  return {
    type: "website",
    url: normalizedUrl,
    accessible: true,
    status: fetched.status,
    title,
    metaDescription,
    h1,
    h2,
    ctas,
    visibleKeywords,
    textSample: bodyText.slice(0, 900),
    clarity: evaluateWebsiteClarity({ title, metaDescription, h1, bodyText, input }),
    seo: {
      hasTitle: Boolean(title),
      hasMetaDescription: Boolean(metaDescription),
      hasH1: h1.length > 0,
      h2Count: h2.length,
      titleMentionsOffer: includesAny(title, [input.mainOffer, input.sector]),
      descriptionMentionsOffer: includesAny(metaDescription, [input.mainOffer, input.sector, input.location]),
    },
    conversion: {
      ctas,
      contactTerms,
      hasContactPath: ctas.length > 0 || contactTerms.length > 0,
    },
    trust: {
      proofTerms,
      hasTestimonials: proofTerms.some((term) => ["témoignage", "avis"].includes(term)),
      hasCaseSignals: proofTerms.some((term) => ["cas client", "réalisation", "projet", "référence"].includes(term)),
    },
    observations: buildWebsiteObservations({ title, metaDescription, h1, h2, ctas, proofTerms, contactTerms, input }),
  };
}

async function analyzeSocial(type, url, input) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return inaccessibleAnalysis(type, `Aucune URL ${type === "facebook" ? "Facebook" : "LinkedIn"} fournie.`);
  }

  const fetched = await fetchHtml(normalizedUrl);
  if (!fetched.ok) {
    return inaccessibleAnalysis(type, `Nous n’avons pas pu analyser directement ce réseau. Pour une analyse plus précise, ajoutez une capture ou les 3 dernières publications.`);
  }

  const html = fetched.html;
  const title = cleanText(extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = cleanText(extractFirst(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    || extractFirst(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i));
  const text = cleanText(stripHtml(html)).slice(0, 5000);
  const lowerText = text.toLowerCase();
  const interactionTerms = findTerms(lowerText, ["j’aime", "like", "commentaire", "partage", "réactions", "comments", "reposts"]);
  const offerMentions = visibleMentions(text, [input.mainOffer, input.sector, input.location]);
  const postSignals = findTerms(lowerText, ["sem", "jour", "hier", "publication", "post", "abonnés", "followers"]);

  const blocked = text.length < 250 || /log in|connectez-vous|sign in|login|authentification/i.test(text);
  if (blocked) {
    return inaccessibleAnalysis(type, `Nous n’avons pas pu analyser directement ce réseau. Pour une analyse plus précise, ajoutez une capture ou les 3 dernières publications.`);
  }

  return {
    type,
    url: normalizedUrl,
    accessible: true,
    status: fetched.status,
    title,
    description,
    textSample: text.slice(0, 700),
    offerMentions,
    activity: {
      postSignals,
      appearsActive: postSignals.length > 0,
      note: postSignals.length > 0
        ? "Des indices de publication ou d’activité sont visibles dans la page lue."
        : "La page est lisible, mais la régularité exacte des publications n’est pas confirmée automatiquement.",
    },
    engagement: {
      interactionTerms,
      hasVisibleInteractions: interactionTerms.length > 0,
    },
    ctas: extractCtas(extractLinks(html), text),
    observations: buildSocialObservations(type, { title, description, offerMentions, interactionTerms, postSignals, input }),
  };
}

function analyzeCoherence(input, website, facebook, linkedin) {
  const sources = [website, facebook, linkedin].filter((source) => source.accessible);
  const offer = input.mainOffer || input.sector;
  const websiteMentionsOffer = sourceMentions(website, offer);
  const facebookMentionsOffer = sourceMentions(facebook, offer);
  const linkedinMentionsOffer = sourceMentions(linkedin, offer);
  const locationMentions = [website, facebook, linkedin].filter((source) => sourceMentions(source, input.location)).length;
  const readableChannels = sources.length;

  return {
    readableChannels,
    offerAligned: [websiteMentionsOffer, facebookMentionsOffer, linkedinMentionsOffer].filter(Boolean).length,
    locationMentions,
    summary: readableChannels === 0
      ? "Aucun support externe n’a pu être lu automatiquement. L’analyse reste basée sur le formulaire."
      : "La cohérence est évaluée à partir des supports réellement accessibles.",
    observations: [
      websiteMentionsOffer
        ? `Le site semble reprendre un élément lié à "${offer}".`
        : `Le site ne permet pas de confirmer clairement l’offre "${offer}" dans les éléments lus.`,
      facebook.accessible
        ? (facebookMentionsOffer ? "Facebook semble reprendre un message lié à l’offre." : "Facebook est lisible, mais l’offre principale n’y ressort pas clairement.")
        : facebook.reason,
      linkedin.accessible
        ? (linkedinMentionsOffer ? "LinkedIn semble reprendre un message lié à l’offre." : "LinkedIn est lisible, mais l’offre principale n’y ressort pas clairement.")
        : linkedin.reason,
      locationMentions > 0
        ? `La localisation "${input.location}" apparaît dans au moins un support lu.`
        : `La localisation "${input.location}" n’est pas confirmée dans les supports lus automatiquement.`,
    ],
  };
}

function analyzePositioning(input, website, competitors = []) {
  const ownText = [
    input.company,
    input.sector,
    input.location,
    input.mainOffer,
    input.targetClient,
    input.commercialMessage,
    website?.title,
    website?.metaDescription,
    ...(website?.h1 || []),
    website?.textSample,
  ].join(" ");
  const ownPillars = extractPositioningPillars(input, ownText);
  const readableCompetitors = competitors.filter((competitor) => competitor.accessible);
  const competitorProfiles = competitors.map((competitor) => {
    const text = [
      competitor.title,
      competitor.metaDescription,
      ...(competitor.h1 || []),
      competitor.textSample,
    ].join(" ");
    return {
      name: competitor.name,
      accessible: competitor.accessible,
      reason: competitor.reason,
      headline: competitor.h1?.[0] || competitor.title || "",
      cta: competitor.ctas?.[0] || "",
      pillars: competitor.accessible ? extractPositioningPillars(input, text) : [],
    };
  });

  const strongestCompetitor = chooseStrongestCompetitor(competitorProfiles)
    || { name: "Concurrent à confirmer", accessible: false, reason: "Aucun concurrent lisible automatiquement." };

  const specificityScore = points([
    ownPillars.includes("cible claire"),
    ownPillars.includes("offre explicite"),
    ownPillars.includes("résultat attendu"),
    ownPillars.includes("zone locale"),
    ownPillars.includes("différence visible"),
  ], 20);

  return {
    ownPillars,
    specificityScore,
    strongestCompetitor,
    competitors: competitorProfiles,
    summary: buildPositioningSummary(input, ownPillars, strongestCompetitor, readableCompetitors.length),
  };
}

function extractPositioningPillars(input, text) {
  const pillars = [];
  const haystack = String(text || "").toLowerCase();
  if (includesAny(haystack, [input.targetClient])) pillars.push("cible claire");
  if (includesAny(haystack, [input.mainOffer, input.sector])) pillars.push("offre explicite");
  if (findTerms(haystack, ["résultat", "gain", "plus", "moins", "sans", "rapide", "simple", "sérénité", "tranquillité", "rentable", "clients", "devis"]).length) pillars.push("résultat attendu");
  if (includesAny(haystack, [input.location])) pillars.push("zone locale");
  if (findTerms(haystack, ["spécialiste", "sur-mesure", "complet", "accompagnement", "expert", "certifié", "garantie", "méthode", "exclusif", "unique"]).length) pillars.push("différence visible");
  return Array.from(new Set(pillars));
}

function chooseStrongestCompetitor(competitors = []) {
  const readable = competitors.filter((competitor) => competitor.accessible);
  if (!readable.length) return null;
  return readable
    .map((competitor) => ({ ...competitor, positioningScore: scoreCompetitorPositioning(competitor) }))
    .sort((a, b) => b.positioningScore - a.positioningScore)[0];
}

function scoreCompetitorPositioning(competitor) {
  let score = 0;
  if ((competitor.headline || "").length > 12) score += 25;
  if (competitor.cta) score += 20;
  score += Math.min(25, (competitor.pillars || []).length * 5);
  if ((competitor.headline || "").length > 45) score += 8;
  return score;
}

function buildPositioningSummary(input, ownPillars, strongestCompetitor, readableCount) {
  const missing = ["cible claire", "offre explicite", "résultat attendu", "zone locale", "différence visible"]
    .filter((pillar) => !ownPillars.includes(pillar));
  if (readableCount > 0 && strongestCompetitor?.headline) {
    return `${input.company} doit être comparée à ses concurrents sur son positionnement, pas seulement sur sa présence. Le concurrent "${strongestCompetitor.name}" affiche un premier message lisible : "${strongestCompetitor.headline}". Votre enjeu est de rendre aussi lisible votre cible, votre offre et la raison de vous choisir.`;
  }
  if (!missing.length) {
    return `${input.company} possède déjà les bases d’un positionnement lisible : cible, offre, zone, résultat attendu et différence. L’enjeu n’est donc pas de tout changer, mais de rendre cette différence plus facile à comparer face aux concurrents réellement observés.`;
  }
  return `${input.company} indique une offre et un marché, mais certains éléments de positionnement restent à rendre plus évidents : ${missing.slice(0, 3).join(", ") || "la raison de vous choisir"}. Les textes concurrents devront être confirmés avec leurs URL ou pendant l’échange inclus.`;
}

function calculateDigitalScore(input, website, facebook, linkedin, coherence) {
  const seo = website.accessible
    ? points([
      website.seo.hasTitle,
      website.seo.hasMetaDescription,
      website.seo.hasH1,
      website.seo.h2Count > 0,
      website.seo.titleMentionsOffer || website.seo.descriptionMentionsOffer,
    ], 20)
    : (input.website ? 5 : 0);
  const formPositioning = points([
    String(input.mainOffer || "").length > 12,
    String(input.targetClient || "").length > 12,
    String(input.commercialMessage || "").length > 25,
    Boolean(input.sector),
    Boolean(input.location),
  ], 20);
  const offerClarity = website.accessible
    ? clamp(Math.round((website.clarity.score * 0.55) + (formPositioning * 0.45)), 0, 20)
    : formPositioning;
  const coherenceScore = clamp(6 + coherence.offerAligned * 4 + Math.min(2, coherence.locationMentions) * 2, 0, 20);
  const readableSocials = [facebook, linkedin].filter((source) => source.accessible);
  const socialActivity = readableSocials.length
    ? clamp(readableSocials.reduce((sum, source) => sum + (source.activity.appearsActive ? 7 : 3), 0), 0, 15)
    : (input.facebook || input.linkedin ? 3 : 0);
  const socialEngagement = readableSocials.length
    ? clamp(readableSocials.reduce((sum, source) => sum + (source.engagement.hasVisibleInteractions ? 7 : 2), 0), 0, 15)
    : 2;
  const conversion = website.accessible
    ? clamp((website.conversion.hasContactPath ? 6 : 2) + Math.min(4, website.conversion.ctas.length * 2), 0, 10)
    : 3;
  const global = seo + offerClarity + coherenceScore + socialActivity + socialEngagement + conversion;

  return {
    seo,
    offerClarity,
    positioning: formPositioning,
    coherence: coherenceScore,
    socialActivity,
    socialEngagement,
    conversion,
    global: clamp(global, 0, 100),
  };
}

function calculateScore(input) {
  let score = 25;
  if (input.website) score += 12;
  if (input.googleBusiness) score += 12;
  if (input.linkedin) score += 8;
  if (input.facebook) score += 6;
  if ((input.mainOffer ?? "").length > 20) score += 10;
  if ((input.targetClient ?? "").length > 20) score += 8;
  if ((input.commercialMessage ?? "").length > 40) score += 8;
  if (input.competitor1 && input.competitor2 && input.competitor3) score += 6;
  return Math.max(0, Math.min(100, score));
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; AgencyKingCheckup/1.0; +https://agency-king.com)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) return { ok: false, status: response.status, reason: `HTTP ${response.status}` };
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { ok: false, status: response.status, reason: "la page ne renvoie pas de HTML lisible" };
    }
    return { ok: true, status: response.status, html: await response.text() };
  } catch (error) {
    return { ok: false, reason: error instanceof Error && error.name === "AbortError" ? "délai de lecture dépassé" : "accès bloqué ou URL inaccessible" };
  } finally {
    clearTimeout(timeout);
  }
}

function inaccessibleAnalysis(type, reason) {
  return {
    type,
    accessible: false,
    reason,
    observations: [reason],
  };
}

function normalizeUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function looksLikeUrl(value) {
  const trimmed = String(value || "").trim();
  return /^https?:\/\//i.test(trimmed) || /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(trimmed);
}

function extractFirst(html, regex) {
  const match = html.match(regex);
  return match ? decodeHtml(match[1]) : "";
}

function extractTags(html, tag, limit = 6) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const results = [];
  let match;
  while ((match = regex.exec(html)) && results.length < limit) {
    const text = cleanText(stripHtml(match[1]));
    if (text) results.push(text);
  }
  return results;
}

function extractLinks(html) {
  const regex = /<a[^>]+href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const results = [];
  let match;
  while ((match = regex.exec(html)) && results.length < 80) {
    const text = cleanText(stripHtml(match[2]));
    if (text) results.push({ href: match[1], text });
  }
  return results;
}

function extractCtas(links, bodyText) {
  const terms = ["contact", "devis", "rendez-vous", "rdv", "appel", "réserver", "demander", "nous écrire", "prendre contact"];
  const fromLinks = links
    .filter((link) => includesAny(link.text, terms) || includesAny(link.href, terms))
    .map((link) => link.text || link.href)
    .filter(Boolean)
    .slice(0, 6);
  const fromText = terms.filter((term) => bodyText.toLowerCase().includes(term)).slice(0, 4);
  return Array.from(new Set([...fromLinks, ...fromText])).slice(0, 8);
}

function extractVisibleKeywords(text, input) {
  const candidates = [
    input.company,
    input.sector,
    input.location,
    input.mainOffer,
    input.targetClient,
    ...String(input.mainOffer || "").split(/\s+/).filter((word) => word.length > 4),
  ];
  return visibleMentions(text, candidates).slice(0, 10);
}

function visibleMentions(text, candidates) {
  return Array.from(new Set(candidates
    .map((item) => cleanText(item))
    .filter((item) => item.length > 2)
    .filter((item) => text.toLowerCase().includes(item.toLowerCase()))));
}

function findTerms(text, terms) {
  return terms.filter((term) => text.includes(term.toLowerCase()));
}

function evaluateWebsiteClarity({ title, metaDescription, h1, bodyText, input }) {
  const checks = [
    includesAny(title, [input.sector, input.mainOffer, input.location]),
    includesAny(metaDescription, [input.sector, input.mainOffer, input.location]),
    h1.some((item) => includesAny(item, [input.sector, input.mainOffer])),
    includesAny(bodyText, [input.mainOffer]),
    includesAny(bodyText, [input.targetClient]),
  ];
  return {
    score: points(checks, 20),
    checks,
  };
}

function buildWebsiteObservations({ title, metaDescription, h1, h2, ctas, proofTerms, contactTerms, input }) {
  return [
    title ? `Title lu : "${title}".` : "Aucun title lisible n’a été trouvé.",
    metaDescription ? `Meta description lue : "${metaDescription}".` : "Aucune meta description lisible n’a été trouvée.",
    h1.length ? `H1 lu : "${h1[0]}".` : "Aucun H1 lisible n’a été trouvé.",
    h2.length ? `${h2.length} intertitre(s) H2 lisible(s).` : "Aucun H2 lisible n’a été trouvé.",
    ctas.length ? `Appels à l’action repérés : ${ctas.slice(0, 3).join(", ")}.` : "Aucun appel à l’action évident n’a été repéré.",
    proofTerms.length ? `Éléments rassurants repérés : ${proofTerms.join(", ")}.` : "Aucun témoignage, cas client ou preuve évidente n’a été repéré dans la page lue.",
    contactTerms.length ? `Chemin de contact repéré : ${contactTerms.join(", ")}.` : "Le chemin vers la prise de contact n’est pas évident dans le texte lu.",
    includesAny(`${title} ${metaDescription} ${h1.join(" ")}`, [input.mainOffer, input.sector])
      ? `L’offre ou le secteur semble présent dans les premiers éléments lus.`
      : `L’offre "${input.mainOffer}" n’apparaît pas clairement dans les premiers éléments lus.`,
  ];
}

function buildSocialObservations(type, { title, description, offerMentions, interactionTerms, postSignals }) {
  const label = type === "facebook" ? "Facebook" : "LinkedIn";
  return [
    title ? `${label} : titre lu "${title}".` : `${label} : titre non lisible.`,
    description ? `${label} : description lue "${description.slice(0, 180)}".` : `${label} : description non lisible.`,
    offerMentions.length ? `${label} reprend des mots liés à l’offre : ${offerMentions.join(", ")}.` : `${label} ne montre pas clairement l’offre dans les éléments lus.`,
    postSignals.length ? `${label} contient des indices d’activité : ${postSignals.join(", ")}.` : `${label} ne permet pas de confirmer la fréquence de publication automatiquement.`,
    interactionTerms.length ? `${label} affiche des indices d’interaction : ${interactionTerms.join(", ")}.` : `${label} ne permet pas de confirmer les interactions automatiquement.`,
  ];
}

function sourceMentions(source, value) {
  if (!source?.accessible || !value) return false;
  const haystack = [
    source.title,
    source.metaDescription,
    source.description,
    ...(source.h1 || []),
    ...(source.h2 || []),
    source.textSample,
  ].join(" ");
  return includesAny(haystack, [value]);
}

function points(checks, max) {
  const valid = checks.filter(Boolean).length;
  return Math.round((valid / checks.length) * max);
}

function includesAny(value, needles) {
  const haystack = String(value || "").toLowerCase();
  return needles
    .filter(Boolean)
    .some((needle) => haystack.includes(String(needle).toLowerCase()));
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function cleanText(value) {
  return decodeHtml(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function maturityFromScore(score) {
  if (score < 40) return "Invisible";
  if (score < 60) return "Visible mais vulnérable";
  if (score < 80) return "Challenger";
  return "Leader local";
}

function riskFromScore(score) {
  if (score < 40) return "Eleve";
  if (score < 70) return "Moyen";
  return "Faible";
}

function buildSummary(input, score, maturity, risk) {
  return `Pour ${input.company}, active dans ${input.sector} à ${input.location}, l'indice est de ${score}/100. Niveau ${maturity}, risque ${risk}. Ce résultat indique si des demandes de devis peuvent partir chez un concurrent plus simple à comprendre ou plus rassurant.`;
}

function productFromCode(code) {
  const products = {
    CHECKUP_27: { code, name: "Le Révélateur de Clients Perdus™", amountCents: 1700 },
    BUMP_17: { code, name: "Le Décodeur de Prospects™", amountCents: 1700 },
    UPSELL_97: { code, name: "Échange de 30 min avec Lindsay", amountCents: 0 },
    CALL_297: { code, name: "Session Stratégique Acquisition™", amountCents: 29700 },
    ACCOMPAGNEMENT: { code, name: "Responsable Communication Externalisée", amountCents: 0 },
  };
  if (!products[code]) throw new Error("Produit test inconnu");
  return products[code];
}

async function syncBrevo(fn) {
  try {
    await fn();
    return { ok: true, message: "Synchronisé avec Brevo" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Synchro Brevo impossible" };
  }
}

async function mollieRequest(path, init) {
  const response = await fetch(`https://api.mollie.com/v2${path}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MOLLIE_API_KEY}`,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Mollie API failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function normalizeProductCodes(productCodes) {
  const codes = Array.isArray(productCodes) ? productCodes : [productCodes];
  const cleaned = codes.filter(Boolean);
  const allowed = new Set(["CHECKUP_27", "BUMP_17", "UPSELL_97"]);

  if (!cleaned.length || cleaned.some((code) => !allowed.has(code))) {
    throw new Error("Produit Mollie invalide");
  }

  return cleaned;
}

function formatEuro(amountCents) {
  return (amountCents / 100).toFixed(2);
}

function publicBaseUrl(req) {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return `http://${req.headers.host}`;
}

async function readDb() {
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) {
    return emptyDb();
  }
  return { ...emptyDb(), ...JSON.parse(await readFile(DB_FILE, "utf8")) };
}

function emptyDb() {
  return { contacts: [], diagnostics: [], purchases: [], events: [], brevoLogs: [], bookings: [], campaigns: [], molliePayments: [], analyticsEvents: [] };
}

async function writeDb(db) {
  dbWriteQueue = dbWriteQueue.then(async () => {
    try {
      await mkdir(DATA_DIR, { recursive: true });
      const tempFile = `${DB_FILE}.tmp`;
      await writeFile(tempFile, JSON.stringify(db, null, 2));
      await rename(tempFile, DB_FILE);
    } catch (err) {
      // Sur Vercel (filesystem read-only), on garde les données en mémoire uniquement
      if (err.code === "EROFS" || err.code === "ENOENT") {
        console.warn("Filesystem read-only, données conservées en mémoire uniquement.");
      } else {
        throw err;
      }
    }
  });
  await dbWriteQueue;
}

async function resolveBrevoLists(envListIds) {
  const cachedFile = join(DATA_DIR, "brevo-test-config.json");
  await mkdir(DATA_DIR, { recursive: true });

  if (existsSync(cachedFile)) {
    const cached = JSON.parse(await readFile(cachedFile, "utf8"));
    return { ...envListIds, ...cached.lists };
  }

  if (!brevo || envListIds["Leads Check-Up"]) return envListIds;

  try {
    const bootstrapped = await brevo.bootstrapCommercialMachine();
    await writeFile(cachedFile, JSON.stringify(bootstrapped, null, 2));
    console.log("Configuration Brevo test créée automatiquement.");
    return { ...envListIds, ...bootstrapped.lists };
  } catch (error) {
    console.log(`Bootstrap Brevo ignoré: ${error instanceof Error ? error.message : "erreur inconnue"}`);
    return envListIds;
  }
}

async function serveFile(res, filePath) {
  const absolute = join(PUBLIC_DIR, filePath);
  if (!absolute.startsWith(PUBLIC_DIR) || !existsSync(absolute)) return notFound(res);

  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
  }[extname(absolute)] ?? "text/plain; charset=utf-8";

  res.writeHead(200, { "Content-Type": contentType });
  res.end(await readFile(absolute));
}

function json(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  return json(res, { ok: false, error: "Page introuvable" }, 404);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function readForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  return Object.fromEntries(new URLSearchParams(body));
}

function numberEnv(name) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseListIds(value) {
  if (Array.isArray(value)) return value.map(Number).filter((id) => Number.isFinite(id) && id > 0);
  return String(value ?? "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function ratio(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function loadLocalEnv() {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return;
  const lines = existsSync(file) ? String(readFileSync(file, "utf8")).split(/\r?\n/) : [];
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
