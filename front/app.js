import { API_URL } from "./config.js";
import { api } from "./api.js";

// Permet de cibler les elements du DOM (raccourci)
const $ = (selector, root = document) => root.querySelector(selector);

// Met à jour dynamiquement l'attribut href pour pointer vers la documentation de l'API
$("#docs-link").href = API_URL;

// Formatage des dates
const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
const formatDate = (iso) => dateFormat.format(new Date(iso));

// Construit un élément sans jamais passer par innerHTML : les données de
// l'API (titres, noms) sont insérées comme du texte.
// Limite les risque de failles XSS
function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === "class") node.className = value;
        else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
}

// Crée un bouton HTML préconfiguré en utilisant la fonction el
function button(label, onClick, className = "") {
    return el("button", { type: "button", class: className, onclick: onClick }, label);
}

// Affiche un message flash temporaire en bas de l'écran (succès ou erreur en rouge si isError vaut true).
function toast(message, isError = false) {
    const node = el("p", { class: isError ? "toast error" : "toast" }, message);
    $("#toasts").append(node);
    // Le message s'auto-détruit au bout de 5 secondes.
    setTimeout(() => node.remove(), 5000);
}

// Exécute une action déclenchée par un bouton et affiche l'erreur de l'API (toast).
async function run(action) {
    try {
        await action();
    } catch (error) {
        toast(error.message, true);
    }
}

// Affiche ou masque un message d'erreur spécifique directement à l'intérieur d'une boîte de dialogue
function showFormError(dialog, error) {
    const target = $(".form-error", dialog);
    target.textContent = error ? error.message : "";
    target.hidden = !error;
}
// Parcourt tous les boutons possédant l'attribut data-cancel pour fermer automatiquement leur modale parente lorsqu'on clique dessus.
for (const cancel of document.querySelectorAll("[data-cancel]")) {
    cancel.addEventListener("click", () => cancel.closest("dialog").close());
}

// Branche un formulaire de boîte de dialogue sur un appel à l'API.
// L'erreur renvoyée par l'API reste affichée dans la boîte, qui ne se ferme
// qu'en cas de succès.
function bindSubmit(dialog, form, handler) {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        showFormError(dialog, null);
        try {
            await handler(new FormData(form));
            dialog.close();
            await refresh();
        } catch (error) {
            showFormError(dialog, error);
        }
    });
}

// --- Onglets ---------------------------------------------------------------

const tabs = ["games", "members"];

// Lit l'URL pour déterminer quel onglet l'utilisateur souhaite consulter. Par défaut, l'onglet des jeux s'affiche.
function currentTab() {
    const name = location.hash.slice(1);
    return tabs.includes(name) ? name : "games";
}

// Masque les sections inactives, affiche l'onglet actif.
// Met à jour les attributs d'accessibilité (aria-current) et charge les données correspondantes (jeux ou adhérents).
async function refresh() {
    const tab = currentTab();
    for (const name of tabs) {
        $(`#${name}`).hidden = name !== tab;
        $(`[data-tab="${name}"]`).toggleAttribute("aria-current", name === tab);
    }
    await run(tab === "games" ? loadGames : loadMembers);
}

// Écoute les changements d'URL pour basculer d'un onglet à l'autre de manière fluide sans recharger la page.
window.addEventListener("hashchange", refresh);

// --- Jeux ------------------------------------------------------------------
// Affiche la liste des jeux ou message vide si liste vide.
async function loadGames() {
    const games = await api.listGames();
    $("#games-empty").hidden = games.length > 0;
    $("#games-list").replaceChildren(...games.map(gameCard));
}

let editingGameID = null; // Déclaration indispensable de la variable d'édition (mémorise si on édite un jeu existant ou si on en crée un nouveau)

// Créer la carte du jeu
function gameCard(game) {
    const players =
    game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers} à ${game.maxPlayers}`;
    const status = game.isAvailable
    ? el("span", { class: "badge ok" }, "Disponible")
    : el("span", { class: "badge busy" }, "Emprunté");
    
    const actions = el("div", { class: "actions" });
    if (game.isAvailable) {
        actions.append(button("Emprunter", () => openBorrowDialog(game), "primary"));
    }
    
    // Ajout des boutons Modifier et Supprimer
    actions.append(button("Modifier", () => openEditGameDialog(game)));
    actions.append(button("Supprimer", () => confirmDeleteGame(game)));
    
    return el(
        "li",
        { class: "card" },
        el("div", { class: "card-head" }, el("h3", {}, game.title), status),
        el("p", { class: "meta" }, `${players} joueur·ses · ${game.durationMinutes} min`),
        actions,
    );
}

const gameDialog = $("#game-dialog");
const gameForm = $("#game-form");

// Réinitialise le formulaire en mode création (editingGameID = null), change le titre de la modale et l'ouvre.
$("#add-game").addEventListener("click", () => {
    editingGameID = null;
    $("#game-dialog-title").textContent = "Ajouter un jeu";
    gameForm.reset();
    showFormError(gameDialog, null);
    gameDialog.showModal();
});

// Ouvre la modale modification et pré-rempli les champs
function openEditGameDialog(game) {
    editingGameID = game.id;
    $("#game-dialog-title").textContent = `Modifier « ${game.title} »`;
    
    gameForm.elements.title.value = game.title;
    gameForm.elements.minPlayers.value = game.minPlayers;
    gameForm.elements.maxPlayers.value = game.maxPlayers;
    gameForm.elements.durationMinutes.value = game.durationMinutes;
    
    showFormError(gameDialog, null);
    gameDialog.showModal();
}

// Extrait les données saisies, puis vérifie l'état.
bindSubmit(gameDialog, gameForm, async (data) => {
    const payload = {
        title: data.get("title").trim(),
        minPlayers: Number(data.get("minPlayers")),
        maxPlayers: Number(data.get("maxPlayers")),
        durationMinutes: Number(data.get("durationMinutes")),
    };
//   Si editingGameID existe, elle appelle l'API de mise à jour (PUT), sinon elle appelle l'API de création (POST)
    if (editingGameID) {
        await api.updateGame(editingGameID, payload);
        toast(`Jeu « ${payload.title} » modifié avec succès.`);
    } else {
        await api.createGame(payload);
        toast(`Jeu « ${payload.title} » créé avec succès.`);
    }
});

// Affiche une boîte de dialogue de confirmation
// Appelle l'API de suppression. Si l'API refuse l'erreur s'affiche en français dans un toast.
async function confirmDeleteGame(game) {
    if (confirm(`Voulez-vous vraiment supprimer le jeu « ${game.title} » ?`)) {
        await run(async () => {
            try {
                await api.deleteGame(game.id);
                toast(`Jeu « ${game.title} » supprimé.`);
                await refresh();
            } catch (error) {
                toast(error.message, true);
            }
        });
    }
}

// --- Emprunts --------------------------------------------------------------

const borrowDialog = $("#borrow-dialog");
const borrowForm = $("#borrow-form");
let borrowedGame = null;

// Charge la liste des adherant (message si pas d'adhérents) dans menu deroulant et ouvre la modal d'emprunt
async function openBorrowDialog(game) {
    await run(async () => {
        const members = await api.listMembers();
        if (members.length === 0) {
            toast("Ajoutez d'abord un·e adhérent·e pour pouvoir emprunter.", true);
            return;
        }
        borrowedGame = game;
        $("#borrow-dialog-title").textContent = `Emprunter « ${game.title} »`;
        $("select", borrowForm).replaceChildren(
            ...members.map((member) => el("option", { value: member.id }, `${member.name} (${member.email})`)),
        );
        showFormError(borrowDialog, null);
        borrowDialog.showModal();
    });
}

// Envoi l'association adherant-jeu puis affiche la confirmation et la duedate prevu.
bindSubmit(borrowDialog, borrowForm, async (data) => {
    const loan = await api.borrow(borrowedGame.id, data.get("memberID"));
    toast(`« ${borrowedGame.title} » emprunté, à rendre avant le ${formatDate(loan.dueAt)}.`);
});

// --- Adhérent·es -----------------------------------------------------------
// Recupère et affiche liste des adherants
async function loadMembers() {
    const members = await api.listMembers();
    $("#members-empty").hidden = members.length > 0;
    $("#members-list").replaceChildren(...members.map(memberRow));
}

function memberRow(member) {
    return el(
        "li",
        { class: "row" },
        el("div", { class: "row-main" }, el("p", {}, el("strong", {}, member.name)), el("p", { class: "meta" }, member.email)),
    );
}

const memberDialog = $("#member-dialog");
const memberForm = $("#member-form");

// Ouvre la modale d'ajout d'un adherant
$("#add-member").addEventListener("click", () => {
    memberForm.reset();
    showFormError(memberDialog, null);
    memberDialog.showModal();
});

bindSubmit(memberDialog, memberForm, (data) =>
    api.createMember({ name: data.get("name").trim(), email: data.get("email").trim() }),
);

// Lance l'application dès le chargement de la page en analysant l'URL active.
refresh();
