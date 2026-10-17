# M.Michel : devoirs et quiz en ligne

Un seul code d'entrée pour tout le monde :
- ton **code professeur** (variable `TEACHER_CODE`) ouvre ton espace ;
- un **code de quiz** (5 caractères, ex. K7M2X) ouvre le quiz pour l'élève.

Sur ton téléphone, le site te reconnaît ensuite tout seul (jusqu'à 30 jours).

## Publier sur Render
1. Crée un dépôt GitHub (privé) et envoie-y tous les fichiers de ce dossier.
2. Donne l'adresse du dépôt à Claude, qui crée le service sur Render,
   ou fais-le toi-même : Render > New > Blueprint > choisis le dépôt (render.yaml fait le reste).
3. Quand Render demande `TEACHER_CODE`, choisis un code long et secret (6 caractères minimum).

## Tester chez toi
    npm install
    TEACHER_CODE=moncodesecret npm start
