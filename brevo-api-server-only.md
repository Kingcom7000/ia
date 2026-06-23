# Connexion Brevo API côté serveur

## Décision

Le formulaire Brevo intégré ne doit pas être utilisé pour ce produit.

Le tunnel **Pourquoi eux gagnent plus de clients que vous ?™** a besoin d'une logique commerciale complète :

- diagnostic commencé ;
- diagnostic terminé ;
- score ;
- niveau ;
- risque ;
- achat 27 euros ;
- bump 17 euros ;
- upsell 97 euros ;
- session 297 euros ;
- réservation Calendly ;
- passage vers l'accompagnement.

Un formulaire Brevo standard ne peut pas porter cette mécanique sans l'affaiblir.

---

## Principe

Le site Agency King collecte les données dans sa propre interface.

Ensuite, le backend appelle Brevo via API.

Flux :

1. Le prospect remplit le diagnostic sur Agency King.
2. Le serveur enregistre les données.
3. Le serveur calcule le score et le risque.
4. Le serveur crée ou met à jour le contact Brevo.
5. Le serveur ajoute les listes et attributs.
6. Le serveur envoie les événements Brevo.
7. Brevo déclenche les automations.

---

## Variables `.env`

```env
BREVO_API_KEY=
BREVO_TRACKER_KEY=
BREVO_SENDER_EMAIL=contact@agency-king.com
BREVO_SENDER_NAME=Agency King
```

La clé Brevo ne doit jamais apparaître :

- dans le HTML ;
- dans le JavaScript navigateur ;
- dans un formulaire embarqué ;
- dans un dépôt Git ;
- dans une capture écran.

---

## Endpoints utilisés

Brevo côté serveur :

- créer dossier : `POST /v3/contacts/folders`
- créer liste : `POST /v3/contacts/lists`
- créer attribut : `POST /v3/contacts/attributes/normal/{name}`
- créer ou mettre à jour contact : `POST /v3/contacts`
- ajouter contact à une liste : `POST /v3/contacts/lists/{listId}/contacts/add`
- envoyer email transactionnel : `POST /v3/smtp/email`
- créer deal CRM : `POST /v3/crm/deals`
- tracker événement automation : `POST https://in-automate.brevo.com/api/v2/trackEvent`

---

## Exemple serveur

```ts
import { BrevoCommercialMachine, runCheckupCompletedWorkflow } from "./src/brevo-commercial-machine";

const brevo = new BrevoCommercialMachine({
  apiKey: process.env.BREVO_API_KEY!,
  trackerKey: process.env.BREVO_TRACKER_KEY,
  senderEmail: process.env.BREVO_SENDER_EMAIL!,
  senderName: process.env.BREVO_SENDER_NAME ?? "Agency King",
});

await runCheckupCompletedWorkflow({
  machine: brevo,
  lists: {
    "Leads Check-Up": 12,
    "Clients 27€": 13,
    "Clients Décodeur": 14,
    "Clients 97€": 15,
    "Clients Session Stratégique": 16,
    "Clients Accompagnement": 17,
  },
  decoderUrl: "https://agency-king.com/checkout?product=decoder",
  contact: {
    email: "client@example.com",
    company: "Entreprise Exemple",
    sector: "Construction",
    location: "Namur",
    mainOffer: "Rénovation énergétique",
    targetClient: "Propriétaires de maisons",
    mainObjective: "Recevoir plus de demandes qualifiées",
    competitors: ["Concurrent A", "Concurrent B", "Concurrent C"],
    score: 54,
    maturity: "Visible mais vulnerable",
    risk: "Moyen",
    reportUrl: "https://agency-king.com/rapport/abc123",
  },
});
```

---

## Ce que le formulaire Brevo devient

Le code Brevo intégré peut être supprimé.

À la place, le formulaire visible sur Agency King doit être un formulaire natif du produit :

- même style qu'Agency King ;
- champs adaptés au diagnostic ;
- progression en étapes ;
- enregistrement côté serveur ;
- appel Brevo après validation.

Le prospect ne doit jamais sentir qu'il s'inscrit à une newsletter. Il doit sentir qu'il lance une analyse stratégique de son entreprise.

