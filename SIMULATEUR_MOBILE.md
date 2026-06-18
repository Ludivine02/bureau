# Simulateur Marge — version mobile / appli (PWA)

`simulateur.html` est une **appli web autonome** (un seul écran, sans données
client) pour calculer, au stand d'une foire, le **prix à annoncer** et la
**marge optimisée** selon le profil d'acheteur. Conçue pour smartphone.

## Fichiers
- `simulateur.html` — l'appli (logique de calcul incluse)
- `manifest.webmanifest`, `service-worker.js`, `icon.svg`, `icon-180/192/512.png`
  — pour l'installation sur l'écran d'accueil et l'usage **hors-ligne**

## L'utiliser sur le téléphone
**Usage immédiat (sans rien installer)** : ouvrez `simulateur.html` dans le
navigateur du téléphone (par e-mail / AirDrop / app Fichiers). Le calcul
fonctionne, y compris hors-ligne (page locale).

**En vraie appli (icône sur l'écran d'accueil, hors-ligne)** : il faut
héberger le dossier à une adresse web (https), puis :
- iPhone (Safari) : ouvrir l'adresse → bouton Partager → **« Sur l'écran d'accueil »**
- Android (Chrome) : menu → **« Installer l'application »**

L'appli ne contient **aucune donnée client** : son hébergement peut être public
sans risque de confidentialité.

## Hébergement
Tout hébergeur de fichiers statiques convient (GitHub Pages, Netlify, etc.).
Pointez l'URL sur `simulateur.html`.
