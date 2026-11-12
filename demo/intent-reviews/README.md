# Démonstrations des dix experts

Chaque dossier contient trois états :

- `baseline` : branche cible de la PR ;
- `correct` : changement valide, verdict positif attendu ;
- `incorrect` : défaut déterministe, review `Changes requested` attendue.

Créer une PR par scénario, avec un seul label dominant. Ne pas mélanger les fixtures dans une même PR.

## bug

- Base : `bug/baseline/cart-total.ts`
- Correct : `bug/correct/cart-total.ts`
- Incorrect : `bug/incorrect/cart-total.ts`
- Titre : `fix: prevent negative payable cart totals`
- Description correcte : une remise supérieure au sous-total est bornée à zéro.
- Description incorrecte : le sous-total est borné avant la soustraction.
- Défaut attendu : `Math.max(0, subtotalCents) - discountCents` peut rester négatif.

## feature

- Base : `feature/baseline/discount-endpoint.ts`
- Correct : `feature/correct/discount-endpoint.ts`
- Incorrect : `feature/incorrect/discount-endpoint.ts`
- Titre : `feat: quote SAVE10 discounts`
- Description : l'endpoint applique 10 % au code `SAVE10` et rejette un sous-total invalide.
- Défaut attendu : le sous-total négatif ou absent n'est pas rejeté.

## refactor

- Base : `refactor/baseline/pricing.ts`
- Correct : `refactor/correct/pricing.ts`
- Incorrect : `refactor/incorrect/pricing.ts`
- Titre : `refactor: extract payable total clamping`
- Description : extraire le bornage sans changer le résultat observable.
- Défaut attendu : `Math.max(1, amountCents)` change le résultat zéro en un.

## documentation

- Base : `documentation/baseline/CART.md`
- Correct : `documentation/correct/CART.md`
- Incorrect : `documentation/incorrect/CART.md`
- Titre : `docs: explain payable cart totals`
- Description : documenter le résultat d'une remise supérieure au sous-total.
- Défaut attendu : l'exemple indique `-300` au lieu de `0`.

## tests

- Base : `tests/baseline/cart-total.ts`
- Correct : `tests/correct/cart-total.test.ts`
- Incorrect : `tests/incorrect/cart-total.test.ts`
- Titre : `test: cover excessive cart discounts`
- Description : ajouter un test qui échoue si le total devient négatif.
- Défaut attendu : le test appelle la fonction puis vérifie seulement `true`.

## ci-cd

- Base : `ci-cd/baseline/ci.yml`
- Correct : `ci-cd/correct/ci.yml`
- Incorrect : `ci-cd/incorrect/ci.yml`
- Titre : `ci: run tests on pull requests`
- Description : exécuter `npm test` pour chaque PR.
- Défaut attendu : le workflow appelle `npm run test:missing-script`.

## dependencies

- Base : `dependencies/baseline/package.json`
- Correct : `dependencies/correct/package.json` et `package-lock.json`
- Incorrect : `dependencies/incorrect/package.json` et `package-lock.json`
- Titre : `chore: update zod to 3.24.1`
- Description : aligner le manifeste et le lockfile sur `zod@3.24.1`.
- Défaut attendu : le manifeste demande `3.24.1` mais le lockfile conserve `3.23.8`.

## performance

- Base : `performance/baseline/lookup.ts`
- Correct : `performance/correct/lookup.ts`
- Incorrect : `performance/incorrect/lookup.ts`
- Titre : `perf: replace repeated scans with a set`
- Description : remplacer le double parcours par une recherche linéaire avec un ensemble.
- Défaut attendu : le double `values.some` quadratique est conservé.

## security

- Base : `security/baseline/token.ts`
- Correct : `security/correct/token.ts`
- Incorrect : `security/incorrect/token.ts`
- Titre : `security: reject malformed access tokens`
- Description : accepter seulement un jeton alphanumérique de 32 caractères.
- Défaut attendu : la valeur `bypass` ou tout texte non vide est accepté.

## breaking-change

- Base : `breaking-change/baseline/public-api.ts`
- Correct : `breaking-change/correct/public-api.ts` et `MIGRATION.md`
- Incorrect : `breaking-change/incorrect/public-api.ts`
- Titre : `feat!: rename calculateTotal to calculatePayableTotal`
- Description : renommer l'API publique et mettre à jour tous les appels.
- Défaut attendu : `renderTotal` appelle encore `calculateTotal`, qui n'existe plus.
