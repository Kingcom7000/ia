# Machine commerciale Brevo - Agency King

## Objectif

Transformer **Pourquoi eux gagnent plus de clients que vous ?™** en tunnel automatisé :

**Diagnostic commencé -> diagnostic terminé -> achat 27 euros -> bump 17 euros -> upsell 97 euros -> session 297 euros -> accompagnement**

Chaque événement doit :

1. enregistrer les données ;
2. créer ou mettre à jour le contact Brevo ;
3. ajouter les listes et attributs correspondants ;
4. déclencher l'automatisation Brevo par événement ;
5. mettre à jour le deal CRM ;
6. alimenter le dashboard admin.

---

## Architecture recommandée

### Décision Brevo

Ne pas utiliser le formulaire Brevo intégré.

Raison :

- il est pensé pour une inscription newsletter simple ;
- il ne pilote pas correctement le diagnostic, le score, le risque, les achats et le pipeline ;
- il ne donne pas assez de contrôle sur les événements du tunnel ;
- il mélange l'expérience commerciale Agency King avec une UI Brevo générique.

Décision technique :

**Toute la connexion Brevo se fait côté serveur via API, avec la clé stockée dans `.env`.**

Le frontend ne doit jamais contenir :

- clé API Brevo ;
- URL d'automatisation sensible ;
- logique de tags ;
- logique de scoring ;
- logique de segmentation.

### Frontend

Pages :

- `/` : page de vente
- `/check-up` : formulaire diagnostic
- `/checkout` : paiement 27 euros + order bump 17 euros
- `/rapport/[id]` : expérience de résultat
- `/upsell/premium` : Diagnostic Concurrentiel Premium 97 euros
- `/session-strategique` : Session Stratégique 297 euros avec Calendly
- `/admin` : dashboard

### Backend

Routes API :

- `POST /api/checkup/start`
- `POST /api/checkup/complete`
- `POST /api/payment/checkout-created`
- `POST /api/payment/webhook`
- `POST /api/calendly/webhook`
- `GET /api/admin/metrics`
- `POST /api/brevo/bootstrap`

### Stockage

Tables minimales :

- `contacts`
- `diagnostics`
- `purchases`
- `events`
- `brevo_sync_logs`
- `calendly_bookings`
- `crm_deals`

---

## Objets Brevo à créer

### Listes

Créer automatiquement dans un dossier Brevo nommé :

**Agency King - Check-Up Acquisition**

Listes :

- Leads Check-Up
- Clients 27€
- Clients Décodeur
- Clients 97€
- Clients Session Stratégique
- Clients Accompagnement

### Attributs contact

Brevo ne doit pas recevoir uniquement des listes. Les séquences doivent pouvoir réagir au contexte du diagnostic.

Attributs :

- `AK_COMPANY`
- `AK_SECTOR`
- `AK_LOCATION`
- `AK_WEBSITE`
- `AK_FACEBOOK`
- `AK_LINKEDIN`
- `AK_GOOGLE_BUSINESS`
- `AK_MAIN_OFFER`
- `AK_TARGET_CLIENT`
- `AK_COMMERCIAL_MESSAGE`
- `AK_MAIN_OBJECTIVE`
- `AK_COMPETITOR_1`
- `AK_COMPETITOR_2`
- `AK_COMPETITOR_3`
- `AK_SCORE`
- `AK_MATURITY`
- `AK_RISK`
- `AK_REPORT_URL`
- `AK_LAST_EVENT`
- `AK_TAGS`
- `AK_LAST_PURCHASE`
- `AK_DEAL_STAGE`
- `AK_CALENDLY_URL`

### Tags

Dans Brevo, les tags demandés sont mieux gérés comme un attribut multi-valeurs `AK_TAGS`, plus des événements trackés. Cela évite de dépendre d'une logique de tags qui n'est pas toujours disponible sur les contacts selon les modules Brevo.

Tags à inscrire dans `AK_TAGS` :

- `CHECKUP_STARTED`
- `CHECKUP_COMPLETED`
- `CHECKUP_27`
- `BUMP_17`
- `UPSELL_97`
- `CALL_297`
- `ACCOMPAGNEMENT`

### Segmentation

Créer des segments Brevo basés sur les attributs :

- `RISQUE_FAIBLE` si `AK_RISK = Faible`
- `RISQUE_MOYEN` si `AK_RISK = Moyen`
- `RISQUE_ELEVE` si `AK_RISK = Eleve`
- `INVISIBLE` si `AK_MATURITY = Invisible`
- `VISIBLE_VULNERABLE` si `AK_MATURITY = Visible mais vulnerable`
- `CHALLENGER` si `AK_MATURITY = Challenger`
- `LEADER_LOCAL` si `AK_MATURITY = Leader local`

Si la création de segments par API n'est pas disponible dans le compte Brevo, les segments sont créés une fois dans l'interface Brevo avec ces conditions. Le système continue ensuite à les alimenter automatiquement via les attributs.

---

## Événements à suivre

Chaque événement doit être enregistré localement et envoyé à Brevo via l'API d'événements.

| Événement interne | Événement Brevo | Effet |
|---|---|---|
| Diagnostic commencé | `checkup_started` | Liste Leads Check-Up, tag CHECKUP_STARTED, deal Nouveau Lead |
| Diagnostic terminé | `checkup_completed` | Tag CHECKUP_COMPLETED, score, risque, maturité, email immédiat |
| Achat 27 euros | `checkup_27_purchased` | Liste Clients 27€, tag CHECKUP_27, deal Client 27€ |
| Bump 17 euros | `decoder_17_purchased` | Liste Clients Décodeur, tag BUMP_17 |
| Achat 97 euros | `premium_97_purchased` | Liste Clients 97€, tag UPSELL_97, deal Client 97€ |
| Session 297 euros | `call_297_purchased` | Liste Clients Session Stratégique, tag CALL_297 |
| RDV Calendly réservé | `calendly_booked` | Deal RDV Réservé, séquence préparation RDV |
| Accompagnement signé | `accompagnement_signed` | Liste Clients Accompagnement, tag ACCOMPAGNEMENT, deal Client Accompagnement |

---

## Pipeline CRM

Nom :

**Agency King - Acquisition PME**

Étapes :

1. Nouveau Lead
2. Diagnostic Terminé
3. Client 27€
4. Client 97€
5. RDV Réservé
6. Proposition Envoyée
7. Client Accompagnement

Règle :

Le deal avance automatiquement uniquement vers l'avant. Un achat ou une réservation ne doit jamais ramener un deal dans une étape précédente.

Note Brevo :

La documentation Brevo confirme que les deals peuvent être créés via `/v3/crm/deals` et associés à un pipeline/stage par attributs `pipeline` et `deal_stage`. La création d'un nouveau pipeline complet peut dépendre du plan Sales et peut nécessiter l'interface Brevo. Une fois les IDs du pipeline et des étapes connus, le système peut tout piloter automatiquement.

---

## Automations Brevo

### Automation 1 - Diagnostic terminé

Déclencheur :

Événement `checkup_completed`

Conditions :

- contact a `CHECKUP_COMPLETED`
- contact n'a pas `CHECKUP_27`

Action immédiate :

Envoyer l'email :

**Votre score est prêt.**

But :

Ramener vers le rapport et le Décodeur de Prospects.

### Automation 2 - Après achat 27 euros

Déclencheur :

Événement `checkup_27_purchased`

Séquence :

- Jour 0 : Votre score est prêt.
- Jour 1 : Pourquoi certaines entreprises paraissent plus crédibles.
- Jour 3 : L'erreur la plus fréquente des PME.
- Jour 5 : Pourquoi les concurrents gagnent parfois sans être meilleurs.
- Jour 7 : Présentation du Diagnostic Concurrentiel Premium.

Sortie de séquence :

Arrêter si `UPSELL_97` est présent.

### Automation 3 - Après achat 97 euros

Déclencheur :

Événement `premium_97_purchased`

Séquence :

- Jour 0 : Rapport livré.
- Jour 2 : Étude de cas.
- Jour 4 : Comment corriger les écarts détectés.
- Jour 6 : Invitation Session Stratégique.
- Jour 8 : Dernier rappel.

Sortie de séquence :

Arrêter si `CALL_297` est présent ou si `calendly_booked` a eu lieu.

### Automation 4 - Session stratégique

Déclencheur :

Événement `call_297_purchased`

Objectif :

Réserver un rendez-vous Calendly.

Actions :

1. Envoyer email avec lien Calendly.
2. Relancer à J+1 si aucun événement `calendly_booked`.
3. Relancer à J+3 si aucun événement `calendly_booked`.
4. Après réservation, envoyer email de préparation.

### Automation 5 - Accompagnement

Déclencheur :

Étape deal `Proposition Envoyée` ou événement `proposal_sent`

Objectif :

Préparer psychologiquement à l'offre Responsable Communication Externalisée.

Angle :

"Le diagnostic montre où agir. La question est maintenant de savoir qui pilote l'exécution chaque mois."

---

## Email immédiat après diagnostic

Sujet :

**Votre score est prêt.**

Corps :

Bonjour,

Votre diagnostic est prêt pour **{{params.company}}**.

Votre **Indice de Domination Locale™** est de **{{params.score}}/100**.

Niveau détecté : **{{params.maturity}}**  
Risque de perte d'opportunités : **{{params.risk}}**

Ce que cela signifie :

{{params.summary}}

Le point le plus important :

{{params.main_blocker}}

Accéder au rapport :

{{params.report_url}}

Débloquer le Décodeur de Prospects™ :

{{params.decoder_url}}

Agency King

---

## Séquence après achat 27 euros

### Jour 0 - Votre score est prêt

But :

Renforcer la valeur du diagnostic et pousser vers le Décodeur si non acheté.

Angle :

"Votre score n'est pas une note. C'est une lecture de ce que vos prospects peuvent percevoir avant de vous contacter."

CTA :

Voir mon rapport.

### Jour 1 - Pourquoi certaines entreprises paraissent plus crédibles

But :

Installer l'idée des signaux de confiance.

Angle :

"La crédibilité n'est pas seulement ce que vous savez faire. C'est ce que le prospect arrive à vérifier rapidement."

CTA :

Voir les signaux manquants.

### Jour 3 - L'erreur la plus fréquente des PME

But :

Créer un effet miroir sans culpabiliser.

Angle :

"Beaucoup d'entreprises expliquent ce qu'elles font, mais pas assez pourquoi elles sont le bon choix."

CTA :

Relire mes 3 freins.

### Jour 5 - Pourquoi les concurrents gagnent parfois sans être meilleurs

But :

Préparer l'upsell concurrentiel.

Angle :

"Un concurrent peut gagner parce qu'il paraît plus évident, plus présent ou plus rassurant."

CTA :

Comparer mes concurrents.

### Jour 7 - Diagnostic Concurrentiel Premium

But :

Vendre le 97 euros.

Angle :

"Vous savez qu'il existe un écart. Vous pouvez maintenant découvrir où vos concurrents prennent l'avantage."

CTA :

Débloquer l'analyse premium.

---

## Séquence après achat 97 euros

### Jour 0 - Rapport livré

But :

Livrer et cadrer la lecture.

CTA :

Ouvrir mon rapport premium.

### Jour 2 - Étude de cas

But :

Montrer qu'un écart de perception se corrige.

CTA :

Voir les priorités applicables à mon entreprise.

### Jour 4 - Comment corriger les écarts détectés

But :

Faire passer de "j'ai compris" à "il faut une méthode".

CTA :

Voir mes priorités 30 jours.

### Jour 6 - Invitation Session Stratégique

But :

Vendre la session 297 euros.

CTA :

Réserver ma session stratégique.

### Jour 8 - Dernier rappel

But :

Créer une échéance propre sans pression agressive.

CTA :

Réserver ma session.

---

## Calendly

Intégration obligatoire :

- lien Calendly affiché après achat 297 euros ;
- lien Calendly envoyé par email ;
- webhook Calendly relié à `/api/calendly/webhook` ;
- dès qu'un rendez-vous est réservé :
  - enregistrer la réservation ;
  - ajouter l'événement `calendly_booked` ;
  - mettre à jour Brevo ;
  - avancer le deal en `RDV Réservé` ;
  - envoyer l'email de préparation.

Variables :

- `CALENDLY_EVENT_URL`
- `CALENDLY_WEBHOOK_SIGNING_KEY`

---

## Dashboard admin

### Indicateurs

- nombre de diagnostics commencés ;
- nombre de diagnostics terminés ;
- nombre de ventes 27 euros ;
- nombre de bumps 17 euros ;
- nombre de ventes 97 euros ;
- nombre de sessions 297 euros ;
- nombre de réservations Calendly ;
- nombre de clients accompagnement ;
- taux diagnostic terminé / commencé ;
- taux achat 27 euros / diagnostic terminé ;
- taux bump / achat 27 euros ;
- taux upsell 97 euros / achat 27 euros ;
- taux session / achat 97 euros ;
- taux accompagnement / session.

### Vue commerciale

Afficher aussi :

- derniers diagnostics ;
- entreprises à risque élevé ;
- entreprises niveau Invisible ;
- clients 97 euros sans session réservée ;
- sessions réservées sans proposition envoyée ;
- propositions envoyées sans accompagnement signé.

---

## Règles d'automatisation

### Diagnostic commencé

Actions :

1. créer l'entrée diagnostic ;
2. créer ou mettre à jour le contact ;
3. ajouter à la liste Leads Check-Up ;
4. ajouter `CHECKUP_STARTED` dans `AK_TAGS` ;
5. envoyer événement `checkup_started` à Brevo ;
6. créer ou mettre à jour le deal en `Nouveau Lead`.

### Diagnostic terminé

Actions :

1. enregistrer le rapport ;
2. calculer score, maturité, risque ;
3. mettre à jour le contact ;
4. ajouter `CHECKUP_COMPLETED` ;
5. envoyer événement `checkup_completed` ;
6. avancer le deal en `Diagnostic Terminé` ;
7. envoyer email immédiat si Brevo automation non configurée.

### Achat 27 euros

Actions :

1. enregistrer paiement ;
2. ajouter liste Clients 27€ ;
3. ajouter `CHECKUP_27` ;
4. envoyer événement `checkup_27_purchased` ;
5. avancer deal `Client 27€` ;
6. afficher upsell 97 euros.

### Bump 17 euros

Actions :

1. enregistrer paiement ;
2. ajouter liste Clients Décodeur ;
3. ajouter `BUMP_17` ;
4. envoyer événement `decoder_17_purchased` ;
5. débloquer la partie Décodeur.

### Achat 97 euros

Actions :

1. enregistrer paiement ;
2. ajouter liste Clients 97€ ;
3. ajouter `UPSELL_97` ;
4. envoyer événement `premium_97_purchased` ;
5. avancer deal `Client 97€` ;
6. proposer Session Stratégique.

### Achat 297 euros

Actions :

1. enregistrer paiement ;
2. ajouter liste Clients Session Stratégique ;
3. ajouter `CALL_297` ;
4. envoyer événement `call_297_purchased` ;
5. afficher Calendly ;
6. envoyer email Calendly.

### Accompagnement signé

Actions :

1. ajouter liste Clients Accompagnement ;
2. ajouter `ACCOMPAGNEMENT` ;
3. envoyer événement `accompagnement_signed` ;
4. avancer deal `Client Accompagnement`.

---

## Principe de conversion

Le tunnel ne doit jamais dire :

"Achetez l'étape suivante parce qu'elle existe."

Il doit toujours dire :

"Vous venez de découvrir un écart. L'étape suivante vous montre quoi corriger, dans quel ordre, et avec quel impact business."
