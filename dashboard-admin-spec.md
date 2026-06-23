# Dashboard admin - Agency King

## Objectif

Donner une vision immédiate de la machine commerciale :

- volume de diagnostics ;
- ventes ;
- conversion ;
- opportunités chaudes ;
- prospects à relancer ;
- progression vers l'accompagnement.

---

## KPIs principaux

| KPI | Calcul |
|---|---|
| Diagnostics commencés | count events `CHECKUP_STARTED` |
| Diagnostics terminés | count events `CHECKUP_COMPLETED` |
| Ventes 27€ | count purchases amount 27 |
| Bumps 17€ | count purchases amount 17 |
| Ventes 97€ | count purchases amount 97 |
| Sessions 297€ | count purchases amount 297 |
| Réservations | count calendly bookings |
| Clients accompagnement | count contacts tag `ACCOMPAGNEMENT` |

---

## Taux de conversion

| Taux | Calcul |
|---|---|
| Diagnostic terminé | diagnostics terminés / diagnostics commencés |
| Achat 27€ | clients 27€ / diagnostics terminés |
| Bump | clients Décodeur / clients 27€ |
| Upsell 97€ | clients 97€ / clients 27€ |
| Session | clients session / clients 97€ |
| RDV réservé | réservations / clients session |
| Accompagnement | clients accompagnement / sessions réservées |

---

## Alertes commerciales

Afficher en priorité :

1. Entreprises `RISQUE_ELEVE` avec score inférieur à 60.
2. Clients 97€ sans session après 48h.
3. Clients 297€ sans réservation Calendly après 24h.
4. Sessions réalisées sans proposition envoyée.
5. Propositions envoyées sans signature après 7 jours.

---

## Colonnes de la table prospects

- entreprise ;
- secteur ;
- localisation ;
- score ;
- maturité ;
- risque ;
- dernière étape ;
- dernier achat ;
- rapport ;
- prochaine action ;
- date de création.

---

## Formule de revenu tunnel

Revenu total :

`ventes_27 * 27 + bumps * 17 + ventes_97 * 97 + sessions * 297 + accompagnements * montant_mensuel`

Revenu moyen par diagnostic terminé :

`revenu_total / diagnostics_termines`

Ce chiffre devient le KPI central pour piloter l'acquisition payante.

