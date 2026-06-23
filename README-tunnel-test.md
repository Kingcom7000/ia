# Tunnel Agency King - mode test

## Lancer localement

```bash
PORT=4175 VITE_PUBLIC_TEST_MODE=true node server.mjs
```

Puis ouvrir :

- Tunnel client : `http://127.0.0.1:4175`
- Dashboard admin : `http://127.0.0.1:4175/admin`
- Session stratégique : `http://127.0.0.1:4175/session-strategique`

## Variables `.env`

```env
BREVO_API_KEY=
BREVO_TRACKER_KEY=
BREVO_SENDER_EMAIL=contact@agency-king.com
BREVO_SENDER_NAME=Agency King
MOLLIE_API_KEY=

BREVO_LIST_LEADS_CHECKUP_ID=
BREVO_LIST_CLIENTS_27_ID=
BREVO_LIST_CLIENTS_DECODEUR_ID=
BREVO_LIST_CLIENTS_97_ID=
BREVO_LIST_CLIENTS_SESSION_ID=
BREVO_LIST_CLIENTS_ACCOMPAGNEMENT_ID=

CALENDLY_EVENT_URL=https://calendly.com/agency-king-com/45min
CALENDLY_WEBHOOK_SIGNING_KEY=
APP_BASE_URL=https://agency-king.com
VITE_PUBLIC_TEST_MODE=true
```

## Mode test

Le mode test garde l'expérience client propre :

- aucun bouton de simulation côté prospect ;
- checkout visuel sans Stripe ;
- validation des étapes payantes uniquement dans `/admin` ;
- badge discret visible seulement dans `/admin` si `VITE_PUBLIC_TEST_MODE=true`.

## Mollie

La clé Mollie doit rester uniquement dans `.env` :

```env
MOLLIE_API_KEY=
```

Le tunnel crée les paiements via l'API Mollie côté serveur :

- `CHECKUP_27` : 17€
- `BUMP_17` : 17€
- `UPSELL_97` : 75€ (session stratégique 1h)

Routes utilisées :

- `POST /api/mollie/create-payment`
- `POST /api/mollie/webhook`
- `GET /api/mollie/payment-status?id=...`

En local, si `MOLLIE_API_KEY` est absente, le tunnel reste en fallback de validation. En production, le webhook doit être accessible publiquement via HTTPS.

## Brevo

Le formulaire Brevo intégré n'est pas utilisé.

Toute la synchronisation passe par le serveur :

- création/mise à jour contact ;
- liste `Leads Check-Up` ;
- événements `CHECKUP_STARTED`, `CHECKUP_COMPLETED`, `CHECKUP_27`, `BUMP_17`, `UPSELL_97`, `RDV_INTERESSE`, `RDV_RESERVE` ;
- attributs `AK_COMPANY`, `AK_SECTOR`, `AK_LOCATION`, `AK_SCORE`, `AK_MATURITY`, `AK_RISK`, `AK_MAIN_OFFER`, `AK_REPORT_URL`, `AK_LAST_EVENT`.

## Calendly

La page `/session-strategique` contient le widget :

```html
<div class="calendly-inline-widget" data-url="https://calendly.com/agency-king-com/45min" style="min-width:320px;height:700px;"></div>
<script type="text/javascript" src="https://assets.calendly.com/assets/external/widget.js" async></script>
```

Configurer ensuite Calendly pour appeler :

`POST /api/calendly/webhook`

afin d'enregistrer `RDV_RESERVE`.
