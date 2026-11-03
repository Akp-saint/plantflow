# PlantFlow

Édition Burkina Faso — gestion opérationnelle pour briqueteries, en franc CFA BCEAO (XOF).

PlantFlow est une application de gestion d’usine de briques en React, Express, Node.js et PostgreSQL. Le projet couvre production, stock, ventes, achats, main-d’œuvre, dépenses, caisse, rapports, workspace multi-usines, rôles et audit. Il conserve une identité et une interface distinctes des références produit consultées; les anciennes valeurs affichées dans le prototype ne sont pas des données réelles.

## Configuration PostgreSQL

L’application lit **`POSTGRES_DATABASE_URL`**. Cette variable est volontairement distincte de `DATABASE_URL`, réservée par l’environnement WebDev à une autre base managée. Le schéma est décrit dans `prisma/schema.prisma`.

Pour un démarrage local avec Docker, installe Docker Compose, copie les paramètres d’exemple, change le mot de passe local, puis lance :

```bash
cp .env.example .env
# Change POSTGRES_PASSWORD et renseigne les paramètres connexion si tu veux tester la connexion. PUBLIC_APP_URL doit correspondre à l’origine utilisée.
# Compose transmet POSTGRES_DATABASE_URL et PUBLIC_APP_URL au conteneur; le DSN utilise le nom réseau `db`.
docker compose up --build -d
```

L’application est sur `http://localhost:3000`. PostgreSQL s’exécute dans un conteneur distinct et les données restent dans le volume `plantflow_pgdata`. Compose applique le schéma Prisma au démarrage du conteneur applicatif.

```bash
docker compose logs -f app
docker compose down          # arrête sans supprimer la base
docker compose down -v       # supprime aussi les données — irréversible
```

Pour une instance PostgreSQL existante utilisée hors Docker, renseigne un DSN `postgresql://...` (hôte généralement `localhost`) dans `POSTGRES_DATABASE_URL`, puis exécute `pnpm exec prisma validate` et `pnpm exec prisma generate`. Les migrations et écritures s’appliquent directement à la base fournie : ne pointe pas des données de production pendant les essais.

## Développement

```bash
corepack pnpm install --frozen-lockfile
cp .env.example .env
# Démarre PostgreSQL localement et vérifie POSTGRES_DATABASE_URL.
set -a && . ./.env && set +a
pnpm exec prisma generate
pnpm exec prisma db push
pnpm dev
```

Vite sert l’interface sur `http://localhost:3000` et transmet `/api/*` à Express sur le port `5000`. Les routes d’API sont documentées dans `API_MAP.md`; `GET /api/health` vérifie aussi la disponibilité PostgreSQL.

## Connexion et rôles

La connexion est autonome : l’administrateur crée un compte avec son nom, son email et un mot de passe. Les mots de passe sont hachés côté serveur et les sessions sont stockées sous forme de hash avec protection CSRF. Le premier compte peut créer son workspace et sa première usine; les rôles OWNER, MANAGER, CASHIER et STAFF limitent ensuite les opérations accessibles.

La devise par défaut est le **franc CFA BCEAO (XOF)** et les modes de règlement proposés sont espèces, banque, Mobile Money et autre.

## Données initiales & Démo commerciale (Seed)

Pour préparer le logiciel pour un pitch ou une démonstration avec des données concrètes (formats de briques réels, matières premières, stocks initiaux, compte de caisse et première vente avec acompte) :

```bash
pnpm seed
```

Identifiants préconfigurés pour la démo :
- **Email :** `admin@plantflow.com`
- **Mot de passe :** `PlantFlow2026!`

## Vérifications

```bash
pnpm typecheck
pnpm build
pnpm build:server
curl -i http://localhost:5000/api/health
```

`SOURCES.md` conserve les constats tirés des liens fournis. Les décisions de périmètre et le suivi des livrables sont dans `plan.md` et `TODO.md`.
