const BREVO_API_BASE = "https://api.brevo.com/v3";
const BREVO_EVENTS_BASE = "https://in-automate.brevo.com/api/v2";

export const BREVO_LISTS = [
  "Leads Check-Up",
  "Clients 27€",
  "Clients Décodeur",
  "Clients 97€",
  "Clients Session Stratégique",
  "Clients Accompagnement",
];

export const BREVO_CONTACT_ATTRIBUTES = [
  "AK_COMPANY",
  "AK_SECTOR",
  "AK_LOCATION",
  "AK_WEBSITE",
  "AK_FACEBOOK",
  "AK_LINKEDIN",
  "AK_GOOGLE_BUSINESS",
  "AK_MAIN_OFFER",
  "AK_TARGET_CLIENT",
  "AK_COMMERCIAL_MESSAGE",
  "AK_MAIN_OBJECTIVE",
  "AK_COMPETITOR_1",
  "AK_COMPETITOR_2",
  "AK_COMPETITOR_3",
  "AK_SCORE",
  "AK_MATURITY",
  "AK_RISK",
  "AK_REPORT_URL",
  "AK_LAST_EVENT",
  "AK_TAGS",
  "AK_LAST_PURCHASE",
  "AK_DEAL_STAGE",
  "AK_CALENDLY_URL",
];

export const BREVO_TAG_TO_EVENT = {
  CHECKUP_STARTED: "checkup_started",
  CHECKUP_COMPLETED: "checkup_completed",
  CHECKUP_27: "checkup_27_purchased",
  BUMP_17: "decoder_17_purchased",
  UPSELL_97: "premium_97_purchased",
  CALL_297: "call_297_purchased",
  ACCOMPAGNEMENT: "accompagnement_signed",
  RDV_INTERESSE: "rdv_interesse",
  RDV_RESERVE: "rdv_reserve",
};

export class BrevoCommercialMachine {
  constructor(options) {
    this.apiKey = options.apiKey;
    this.trackerKey = options.trackerKey;
    this.senderEmail = options.senderEmail;
    this.senderName = options.senderName;
  }

  async createOrUpdateContact(contact, listIds = []) {
    const safeListIds = listIds.filter((listId) => Number.isFinite(listId));

    return this.request("/contacts", {
      method: "POST",
      body: {
        email: contact.email,
        updateEnabled: true,
        listIds: safeListIds,
        attributes: this.toBrevoAttributes(contact),
      },
    });
  }

  async addContactToList(email, listId) {
    if (!Number.isFinite(listId)) return null;

    return this.request(`/contacts/lists/${listId}/contacts/add`, {
      method: "POST",
      body: { emails: [email] },
    });
  }

  async trackEvent(event, email, properties = {}) {
    if (!this.trackerKey) return null;

    const response = await fetch(`${BREVO_EVENTS_BASE}/trackEvent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ma-key": this.trackerKey,
      },
      body: JSON.stringify({ email, event, properties }),
    });

    if (!response.ok) {
      throw new Error(`Brevo event failed: ${response.status} ${await response.text()}`);
    }

    return true;
  }

  async sendImmediateScoreEmail(contact, decoderUrl) {
    return this.request("/smtp/email", {
      method: "POST",
      body: {
        sender: { email: this.senderEmail, name: this.senderName },
        to: [{ email: contact.email, name: contact.company }],
        subject: "Votre score est prêt.",
        htmlContent: this.scoreEmailHtml(contact, decoderUrl),
        params: {
          company: contact.company,
          score: contact.score,
          maturity: contact.maturity,
          risk: contact.risk,
          report_url: contact.reportUrl,
          decoder_url: decoderUrl,
        },
      },
    });
  }

  async sendAbandonedCheckoutEmail(params) {
    return this.request("/smtp/email", {
      method: "POST",
      body: {
        sender: { email: this.senderEmail, name: this.senderName },
        to: [{ email: params.email, name: params.company }],
        subject: "Votre analyse est prête — mais il y a un problème",
        htmlContent: `
          <p>Bonjour,</p>
          <p>Votre analyse pour <strong>${params.company}</strong> est terminée.</p>
          <p>Votre score est <strong>${params.score ?? "--"}/100</strong>.</p>
          <p>Nous n'avons pas pu vous la livrer car le paiement n'a pas été finalisé.</p>
          <p>Pour des raisons de confidentialité, elle sera supprimée dans 24h.</p>
          <p><a href="${params.checkoutUrl}">Accéder à mon analyse — 17 €</a></p>
          <p>Agency King</p>
        `,
      },
    });
  }

  async createDeal(contact, stageIds, pipelineId) {
    const stage = contact.dealStage ?? "Nouveau Lead";

    return this.request("/crm/deals", {
      method: "POST",
      body: {
        name: `${contact.company} - ${stage}`,
        attributes: {
          pipeline: pipelineId,
          deal_stage: stageIds[stage],
          amount: this.amountForStage(stage),
          deal_name: `${contact.company} - Le Révélateur de Clients Perdus™`,
        },
      },
    });
  }

  async createEmailCampaign(input) {
    const body = {
      name: input.name,
      subject: input.subject,
      sender: input.sender,
      type: "classic",
      htmlContent: input.htmlContent,
      recipients: { listIds: input.listIds },
      previewText: input.previewText,
      tag: input.tag,
    };

    if (input.scheduledAt) body.scheduledAt = input.scheduledAt;

    return this.request("/emailCampaigns", { method: "POST", body });
  }

  async createFolder(name = "Agency King - Révélateur de Clients Perdus") {
    return this.request("/contacts/folders", {
      method: "POST",
      body: { name },
    });
  }

  async bootstrapLists(folderId) {
    const lists = {};

    for (const name of BREVO_LISTS) {
      const created = await this.request("/contacts/lists", {
        method: "POST",
        body: { folderId, name },
      });
      lists[name] = created.id;
    }

    return lists;
  }

  async bootstrapCommercialMachine() {
    const folder = await this.createFolder();
    const lists = await this.bootstrapLists(folder.id);

    for (const attribute of BREVO_CONTACT_ATTRIBUTES) {
      try {
        await this.createTextAttribute(attribute);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("already exists") && !message.includes("duplicate")) throw error;
      }
    }

    return { folderId: folder.id, lists };
  }

  async createTextAttribute(name) {
    return this.request(`/contacts/attributes/normal/${name}`, {
      method: "POST",
      body: { type: "text" },
    });
  }

  async request(path, init) {
    const response = await fetch(`${BREVO_API_BASE}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        "api-key": this.apiKey,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Brevo API failed: ${response.status} ${await response.text()}`);
    }

    if (response.status === 204) return undefined;
    return response.json();
  }

  toBrevoAttributes(contact) {
    return {
      AK_COMPANY: contact.company,
      AK_SECTOR: contact.sector,
      AK_LOCATION: contact.location,
      AK_WEBSITE: contact.website,
      AK_FACEBOOK: contact.facebook,
      AK_LINKEDIN: contact.linkedin,
      AK_GOOGLE_BUSINESS: contact.googleBusiness,
      AK_MAIN_OFFER: contact.mainOffer,
      AK_TARGET_CLIENT: contact.targetClient,
      AK_COMMERCIAL_MESSAGE: contact.commercialMessage,
      AK_MAIN_OBJECTIVE: contact.mainObjective,
      AK_COMPETITOR_1: contact.competitors[0],
      AK_COMPETITOR_2: contact.competitors[1],
      AK_COMPETITOR_3: contact.competitors[2],
      AK_SCORE: contact.score,
      AK_MATURITY: contact.maturity,
      AK_RISK: contact.risk,
      AK_REPORT_URL: contact.reportUrl,
      AK_LAST_EVENT: contact.tags?.at(-1),
      AK_TAGS: contact.tags?.join(","),
      AK_LAST_PURCHASE: contact.lastPurchase,
      AK_DEAL_STAGE: contact.dealStage,
      AK_CALENDLY_URL: contact.calendlyUrl,
    };
  }

  amountForStage(stage) {
    const amounts = {
      "Nouveau Lead": 0,
      "Analyse Terminée": 0,
      "Client 27€": 17,
      "Client 97€": 0,
      "RDV Réservé": 297,
      "Proposition Envoyée": 1200,
      "Client Accompagnement": 1200,
    };

    return amounts[stage];
  }

  scoreEmailHtml(contact, decoderUrl) {
    const summary = `Pour ${contact.company}, ce score montre si un prospect risque de partir comparer ailleurs avant de demander un devis, surtout face à ${contact.competitors.join(", ")}.`;

    return `
      <p>Bonjour,</p>
      <p>Votre analyse est prête pour <strong>${contact.company}</strong>.</p>
      <p>Votre <strong>Indice de Domination Locale™</strong> est de <strong>${contact.score}/100</strong>.</p>
      <p>Niveau détecté : <strong>${contact.maturity}</strong><br>Risque de demandes qui partent ailleurs : <strong>${contact.risk}</strong></p>
      <p>${summary}</p>
      <p>Le point le plus important : dans le secteur ${contact.sector}, sur la zone ${contact.location}, votre offre ${contact.mainOffer} doit donner assez vite envie de vous contacter plutôt que de continuer la comparaison.</p>
      <p><strong>Garantie :</strong> Si après avoir lu votre analyse vous estimez n'avoir reçu aucune information utile sur votre situation commerciale réelle, nous vous remboursons intégralement sous 30 jours, sans question.</p>
      <p><a href="${contact.reportUrl}">Accéder au rapport</a></p>
      <p><a href="${decoderUrl}">Débloquer le Décodeur de Prospects™</a></p>
      <p>Agency King</p>
    `;
  }
}

export async function runCheckupCompletedWorkflow(params) {
  const contact = {
    ...params.contact,
    tags: [...(params.contact.tags ?? []), "CHECKUP_COMPLETED"],
    dealStage: "Analyse Terminée",
  };

  await params.machine.createOrUpdateContact(contact, [params.lists["Leads Check-Up"]]);
  await params.machine.trackEvent("checkup_completed", contact.email, {
    company: contact.company,
    score: contact.score,
    maturity: contact.maturity,
    risk: contact.risk,
    reportUrl: contact.reportUrl,
  });
  await params.machine.sendImmediateScoreEmail(contact, params.decoderUrl);
}

export async function runCheckupStartedWorkflow(params) {
  const contact = {
    ...params.contact,
    tags: uniqueTags([...(params.contact.tags ?? []), "CHECKUP_STARTED"]),
    dealStage: "Nouveau Lead",
  };

  await params.machine.createOrUpdateContact(contact, [params.lists["Leads Check-Up"]]);
  await params.machine.trackEvent("checkup_started", contact.email, {
    company: contact.company,
    sector: contact.sector,
    location: contact.location,
    mainOffer: contact.mainOffer,
  });
}

export async function runPurchaseWorkflow(params) {
  const purchaseMap = {
    CHECKUP_27: { list: "Clients 27€", stage: "Client 27€", label: "Le Révélateur de Clients Perdus™ 17€" },
    BUMP_17: { list: "Clients Décodeur", stage: params.contact.dealStage ?? "Client 27€", label: "Le Décodeur de Prospects™ 17€" },
    UPSELL_97: { list: "Clients 97€", stage: "Client 97€", label: "Échange de 30 min avec Lindsay" },
    CALL_297: { list: "Clients Session Stratégique", stage: "Client 97€", label: "Échange de 30 min avec Lindsay" },
    ACCOMPAGNEMENT: { list: "Clients Accompagnement", stage: "Client Accompagnement", label: "Responsable Communication Externalisée" },
  };

  const rule = purchaseMap[params.purchase];
  const contact = {
    ...params.contact,
    tags: uniqueTags([...(params.contact.tags ?? []), params.purchase]),
    lastPurchase: rule.label,
    dealStage: rule.stage,
  };

  const listId = params.lists[rule.list];

  await params.machine.createOrUpdateContact(contact, listId ? [listId] : []);
  if (listId) await params.machine.addContactToList(contact.email, listId);
  await params.machine.trackEvent(BREVO_TAG_TO_EVENT[params.purchase], contact.email, {
    company: contact.company,
    purchase: rule.label,
    score: contact.score,
    maturity: contact.maturity,
    risk: contact.risk,
  });
}

export async function runCalendlyBookedWorkflow(params) {
  const contact = {
    ...params.contact,
    calendlyUrl: params.calendlyEventUrl,
    dealStage: "RDV Réservé",
  };

  await params.machine.createOrUpdateContact(contact);
  await params.machine.trackEvent("calendly_booked", contact.email, {
    company: contact.company,
    calendlyEventUrl: params.calendlyEventUrl,
    startTime: params.startTime,
  });
}

export async function runCommercialEventWorkflow(params) {
  const contact = {
    ...params.contact,
    tags: uniqueTags([...(params.contact.tags ?? []), params.event]),
    dealStage: params.event === "RDV_RESERVE" ? "RDV Réservé" : params.contact.dealStage,
  };

  await params.machine.createOrUpdateContact(contact);
  await params.machine.trackEvent(BREVO_TAG_TO_EVENT[params.event], contact.email, {
    company: contact.company,
    score: contact.score,
    maturity: contact.maturity,
    risk: contact.risk,
    lastEvent: params.event,
  });
}

function uniqueTags(tags) {
  return Array.from(new Set(tags));
}
