-- Schéma PostgreSQL — Système de surveillance salle serveur
-- Remplace le schéma SQLite précédent
-- Compatible Neon (PostgreSQL 16+)

CREATE TABLE IF NOT EXISTS mesures (
  id           SERIAL PRIMARY KEY,
  capteur_id   TEXT NOT NULL,
  temperature  DOUBLE PRECISION,
  humidite     DOUBLE PRECISION,
  qualite_air  INTEGER,
  timestamp    TEXT,
  recu_le      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alertes (
  id                   SERIAL PRIMARY KEY,
  capteur_id           TEXT NOT NULL,
  type_anomalie        TEXT NOT NULL,
  valeur_declenchante  DOUBLE PRECISION,
  valeur_normale       DOUBLE PRECISION,
  message              TEXT,
  recommandation       TEXT,
  priorite             TEXT,
  delai_action         TEXT,
  statut               TEXT DEFAULT 'active',
  cree_le              TIMESTAMPTZ DEFAULT NOW(),
  acquittee_le         TIMESTAMPTZ
);

-- Module 12 : Gestion des droits et notifications

CREATE TABLE IF NOT EXISTS utilisateurs (
  id                  SERIAL PRIMARY KEY,
  nom                 TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  mot_de_passe_hash   TEXT NOT NULL,
  role                TEXT DEFAULT 'operateur',
  actif               INTEGER DEFAULT 1,
  cree_le             TIMESTAMPTZ DEFAULT NOW(),
  derniere_connexion  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS config (
  cle        TEXT PRIMARY KEY,
  valeur     TEXT NOT NULL,
  modifie_le TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logs_activite (
  id               SERIAL PRIMARY KEY,
  utilisateur_id   INTEGER,
  utilisateur_email TEXT,
  action           TEXT NOT NULL,
  details          TEXT,
  ip               TEXT,
  timestamp        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emails_envoyes (
  id             SERIAL PRIMARY KEY,
  capteur_id     TEXT NOT NULL,
  type_anomalie  TEXT NOT NULL,
  envoye_le      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS codes_otp (
  id             SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL,
  code_hash      TEXT NOT NULL,
  expire_le      TIMESTAMPTZ NOT NULL,
  utilise        INTEGER DEFAULT 0,
  tentatives     INTEGER DEFAULT 0,
  cree_le        TIMESTAMPTZ DEFAULT NOW()
);
