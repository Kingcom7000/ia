# Agency King AI - Tunnel d'analyse

Tunnel web Agency King pour lancer une analyse commerciale, connecter Brevo côté serveur, simuler ou créer un paiement Mollie, afficher le rapport et proposer un appel stratégique avec Lindsay.

## Installation locale

Prérequis :

- Node.js 24 ou plus récent
- Une clé Brevo API v3 pour la synchronisation production
- Une clé Mollie API si le paiement réel est activé

```bash
cp .env.example .env
node server.mjs
```

Puis ouvrir :

```text
http://127.0.0.1:4173
```

## Démarrage

Le projet n'a pas de dépendances npm obligatoires pour fonctionner dans sa version actuelle.

```bash
npm start
```

ou directement :

```bash
node server.mjs
```

## Variables d'environnement

Toutes les clés sensibles doivent rester dans `.env` en local ou dans les variables d'environnement Render. Ne jamais les mettre dans le code.

Variables principales :

```env
PORT=
HOST=0.0.0.0
APP_BASE_URL=https://votre-domaine.com

BREVO_API_KEY=
BREVO_TRACKER_KEY=
BREVO_SENDER_EMAIL=contact@agency-king.com
BREVO_SENDER_NAME=Agency King

MOLLIE_API_KEY=

CALENDLY_EVENT_URL=
CALENDLY_WEBHOOK_SIGNING_KEY=

VITE_PUBLIC_TEST_MODE=false
```

Variables Brevo optionnelles si les listes existent déjà :

```env
BREVO_FOLDER_ID=
BREVO_LIST_LEADS_CHECKUP_ID=
BREVO_LIST_CLIENTS_27_ID=
BREVO_LIST_CLIENTS_DECODEUR_ID=
BREVO_LIST_CLIENTS_97_ID=
BREVO_LIST_CLIENTS_SESSION_ID=
BREVO_LIST_CLIENTS_ACCOMPAGNEMENT_ID=
BREVO_PIPELINE_ID=
BREVO_STAGE_NOUVEAU_LEAD=
BREVO_STAGE_DIAGNOSTIC_TERMINE=
BREVO_STAGE_CLIENT_27=
BREVO_STAGE_CLIENT_97=
BREVO_STAGE_RDV_RESERVE=
BREVO_STAGE_PROPOSITION_ENVOYEE=
BREVO_STAGE_CLIENT_ACCOMPAGNEMENT=
```

## Déploiement Render

1. Créer un repository GitHub et pousser ce projet.
2. Dans Render, créer un **Web Service** depuis le repository GitHub.
3. Configuration recommandée :
   - Runtime : Node
   - Build command : laisser vide ou utiliser `echo "No build required"`
   - Start command : `npm start`
   - Node version : Node 24 ou plus récent
4. Ajouter les variables d'environnement dans Render :
   - `APP_BASE_URL` avec l'URL Render ou le domaine final
   - `BREVO_API_KEY`
   - `BREVO_SENDER_EMAIL`
   - `BREVO_SENDER_NAME`
   - `MOLLIE_API_KEY` si paiement réel activé
   - `VITE_PUBLIC_TEST_MODE=false`
5. Déployer.
6. Après déploiement, tester :
   - `/`
   - `/session-strategique`
   - `/admin` uniquement pour le contrôle interne

Render fournit automatiquement `PORT`. Le serveur écoute sur `0.0.0.0`, ce qui est nécessaire pour Render.

## Sécurité

- `.env` est ignoré par Git.
- `data/` est ignoré par Git sauf `data/.gitkeep`.
- Les clés Brevo et Mollie sont lues depuis `process.env`.
- Le frontend ne contient aucune clé API.

