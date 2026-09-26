/* Voorraadkast — UI-laag (classic script, geen modules).
 * Gebruikt window.DB uit js/db.js.
 */
(function () {
  'use strict';

  /* ======================================================================
     Constanten
     ====================================================================== */
  var INGREDIENT_CATEGORIES = [
    'Groente', 'Fruit', 'Zuivel & eieren', 'Vlees & vis', 'Granen & pasta',
    'Peulvruchten & noten', 'Kruiden & specerijen', 'Sauzen & olie', 'Bakken', 'Overig'
  ];
  var RECIPE_CATEGORIES = ['Ontbijt', 'Lunch', 'Diner', 'Soep', 'Salade', 'Dessert', 'Snack'];
  var TABS = ['voorraad', 'maken', 'recepten'];
  var TAB_KEY = 'voorraadkast.activeTab';

  /* ======================================================================
     State
     ====================================================================== */
  var state = {
    ready: false,
    tab: 'voorraad',
    ingredients: [],          // [{name, category, staple}]
    pantry: new Set(),        // namen
    recipes: [],
    collapsed: new Set(),     // ingeklapte categorieën
    pantrySearch: '',
    make: { search: '', category: '', maxMissing: 'any' },
    rec: { search: '', category: '' },
    detailId: null,
    editingId: null
  };

  /* ======================================================================
     Helpers
     ====================================================================== */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) { /* negeren */ }
  }

  function toast(message, type) {
    var region = $('#toast-region');
    var el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.textContent = message;
    region.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, type === 'error' ? 5000 : 3000);
  }

  function showError(message) {
    var banner = $('#error-banner');
    banner.textContent = message;
    banner.hidden = false;
  }

  function errMsg(err) {
    return (err && err.message) ? err.message : String(err || 'Onbekende fout');
  }

  function staples() {
    return state.ingredients.filter(function (i) { return i.staple; });
  }
  function stapleSet() {
    var s = new Set();
    staples().forEach(function (i) { s.add(norm(i.name)); });
    return s;
  }
  function pantryNormSet() {
    var s = new Set();
    state.pantry.forEach(function (n) { s.add(norm(n)); });
    return s;
  }
  function findIngredient(name) {
    var n = norm(name);
    for (var i = 0; i < state.ingredients.length; i++) {
      if (norm(state.ingredients[i].name) === n) return state.ingredients[i];
    }
    return null;
  }
  function findRecipe(id) {
    for (var i = 0; i < state.recipes.length; i++) {
      if (String(state.recipes[i].id) === String(id)) return state.recipes[i];
    }
    return null;
  }
  /* Niet-basis items in voorraad */
  function pantryCount() {
    var st = stapleSet(), c = 0;
    state.pantry.forEach(function (n) { if (!st.has(norm(n))) c++; });
    return c;
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function fillSelect(select, options, allLabel) {
    var cur = select.value;
    var html = allLabel ? '<option value="">' + esc(allLabel) + '</option>' : '';
    html += options.map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('');
    select.innerHTML = html;
    if (cur && options.indexOf(cur) !== -1) select.value = cur;
  }

  function recipeCategories() {
    var list = RECIPE_CATEGORIES.slice();
    state.recipes.forEach(function (r) {
      if (r.category && list.indexOf(r.category) === -1) list.push(r.category);
    });
    return list;
  }

  function ingredientCategoriesInUse() {
    var list = INGREDIENT_CATEGORIES.slice();
    state.ingredients.forEach(function (i) {
      if (i.category && list.indexOf(i.category) === -1) list.push(i.category);
    });
    return list;
  }

  /* Eigen matchpercentage (0-100), consistent met have/missing */
  function pctOf(entry) {
    var total = entry.have.length + entry.missing.length;
    if (total === 0) return 100;
    return Math.round(entry.have.length / total * 100);
  }

  function rank() {
    try {
      return DB.rankRecipes(state.recipes, Array.from(state.pantry), state.ingredients) || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  /* ======================================================================
     Data laden
     ====================================================================== */
  function loadAll() {
    return Promise.all([DB.getIngredients(), DB.getPantry(), DB.getRecipes()]).then(function (res) {
      state.ingredients = res[0] || [];
      state.pantry = new Set(res[1] || []);
      state.recipes = res[2] || [];
      refreshStaticOptions();
      renderAll();
    });
  }

  function refreshStaticOptions() {
    fillSelect($('#new-ing-cat'), ingredientCategoriesInUse());
    fillSelect($('#make-cat'), recipeCategories(), 'Alle categorieën');
    fillSelect($('#rec-cat'), recipeCategories(), 'Alle categorieën');
    fillSelect($('#rf-category'), recipeCategories());
    $('#known-ingredients').innerHTML = state.ingredients.map(function (i) {
      return '<option value="' + esc(i.name) + '"></option>';
    }).join('');
  }

  /* ======================================================================
     Tabs
     ====================================================================== */
  function setTab(tab, focus) {
    if (TABS.indexOf(tab) === -1) tab = 'voorraad';
    state.tab = tab;
    storageSet(TAB_KEY, tab);
    $all('.tab').forEach(function (b) {
      if (b.getAttribute('data-tab') === tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    TABS.forEach(function (t) { $('#view-' + t).hidden = (t !== tab); });
    renderCurrent();
    if (focus) {
      var h = $('#view-' + tab + ' h2');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
    }
  }

  function renderCurrent() {
    if (!state.ready) return;
    if (state.tab === 'voorraad') renderPantry();
    else if (state.tab === 'maken') renderMake();
    else renderRecipes();
  }

  function renderAll() {
    if (!state.ready) return;
    renderCurrent();
    if (state.detailId != null && $('#detail-dialog').open) renderDetail();
  }

  /* ======================================================================
     View: Mijn voorraad
     ====================================================================== */
  function renderPantry() {
    var q = norm(state.pantrySearch);
    var st = staples();

    // Basisvoorraad-notitie
    $('#staples-note').textContent = st.length
      ? 'Basisvoorraad (altijd aanwezig verondersteld): ' + st.map(function (i) { return i.name; }).join(', ') + '.'
      : '';

    updatePantryCounter();

    var groups = {};
    state.ingredients.forEach(function (ing) {
      if (ing.staple) return;
      if (q && norm(ing.name).indexOf(q) === -1) return;
      var cat = ing.category || 'Overig';
      (groups[cat] = groups[cat] || []).push(ing);
    });

    var cats = ingredientCategoriesInUse().filter(function (c) { return groups[c] && groups[c].length; });
    var container = $('#pantry-groups');

    if (!cats.length) {
      container.innerHTML = q
        ? '<div class="empty"><h3>Niets gevonden</h3><p>Geen ingrediënt komt overeen met “' + esc(state.pantrySearch) + '”. Voeg het hieronder zelf toe.</p></div>'
        : '<div class="empty"><h3>Nog geen ingrediënten</h3><p>Voeg hieronder een ingrediënt toe.</p></div>';
      return;
    }

    container.innerHTML = cats.map(function (cat, idx) {
      var items = groups[cat].slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'nl'); });
      var expanded = q ? true : !state.collapsed.has(cat);
      var inCount = items.filter(function (i) { return state.pantry.has(i.name); }).length;
      var panelId = 'cat-panel-' + idx;
      return '<section class="cat-group" data-cat="' + esc(cat) + '">' +
        '<button type="button" class="cat-toggle" data-action="toggle-cat" data-cat="' + esc(cat) + '"' +
        ' aria-expanded="' + expanded + '" aria-controls="' + panelId + '">' +
        '<span class="cat-name">' + esc(cat) + '</span>' +
        '<span class="cat-meta"><span class="cat-badge" data-cat-count>' + inCount + '/' + items.length + '</span>' +
        '<span class="chevron" aria-hidden="true">&#9662;</span></span>' +
        '</button>' +
        '<div class="chips" id="' + panelId + '"' + (expanded ? '' : ' hidden') + '>' +
        items.map(function (i) {
          var on = state.pantry.has(i.name);
          return '<button type="button" class="chip" data-action="toggle-ing" data-name="' + esc(i.name) + '" aria-pressed="' + on + '">' + esc(i.name) + '</button>';
        }).join('') +
        '</div></section>';
    }).join('');
  }

  function updatePantryCounter() {
    var n = pantryCount();
    $('#pantry-counter').innerHTML = n
      ? 'Je hebt <strong>' + n + '</strong> ' + (n === 1 ? 'ingrediënt' : 'ingrediënten') + ' in huis'
      : 'Nog niets geselecteerd';
  }

  function updateCatBadge(chip) {
    var group = chip.closest('.cat-group');
    if (!group) return;
    var chips = $all('.chip', group);
    var on = chips.filter(function (c) { return c.getAttribute('aria-pressed') === 'true'; }).length;
    var badge = $('[data-cat-count]', group);
    // Bij zoekfilter tonen we alleen zichtbare chips; dat is prima.
    if (badge) badge.textContent = on + '/' + chips.length;
  }

  function toggleIngredient(chip) {
    var name = chip.getAttribute('data-name');
    var on = !state.pantry.has(name);
    // Optimistische update
    if (on) state.pantry.add(name); else state.pantry.delete(name);
    chip.setAttribute('aria-pressed', String(on));
    updateCatBadge(chip);
    updatePantryCounter();
    DB.setInPantry(name, on).catch(function (err) {
      if (on) state.pantry.delete(name); else state.pantry.add(name);
      chip.setAttribute('aria-pressed', String(!on));
      updateCatBadge(chip);
      updatePantryCounter();
      toast('Opslaan mislukt: ' + errMsg(err), 'error');
    });
  }

  function clearPantry() {
    if (!state.pantry.size) { toast('Je voorraad is al leeg.'); return; }
    if (!window.confirm('Weet je zeker dat je je hele voorraad wilt wissen?')) return;
    DB.clearPantry().then(function () {
      state.pantry = new Set();
      renderAll();
      toast('Voorraad gewist.');
    }).catch(function (err) { toast('Wissen mislukt: ' + errMsg(err), 'error'); });
  }

  function addCustomIngredient(e) {
    e.preventDefault();
    var input = $('#new-ing-name');
    var name = input.value.trim().replace(/\s+/g, ' ');
    var category = $('#new-ing-cat').value || 'Overig';
    input.classList.remove('invalid');
    if (!name) {
      input.classList.add('invalid');
      input.focus();
      toast('Vul een naam in.', 'error');
      return;
    }
    var existing = findIngredient(name);
    if (existing) {
      toast('“' + existing.name + '” bestaat al (' + existing.category + ').', 'error');
      return;
    }
    DB.addIngredient({ name: name, category: category })
      .then(function () { return DB.setInPantry(name, true); })
      .then(function () {
        input.value = '';
        state.collapsed.delete(category);
        return loadAll();
      })
      .then(function () { toast('“' + name + '” toegevoegd aan je voorraad.'); })
      .catch(function (err) { toast('Toevoegen mislukt: ' + errMsg(err), 'error'); });
  }

  /* ======================================================================
     View: Wat kan ik maken?
     ====================================================================== */
  function renderMake() {
    var list = $('#make-list');
    var counter = $('#make-counter');

    if (pantryCount() === 0) {
      counter.textContent = '';
      list.innerHTML = '<div class="empty" style="grid-column:1/-1">' +
        '<h3>Je voorraad is nog leeg</h3>' +
        '<p>Geef eerst aan welke ingrediënten je in huis hebt, dan laten we zien wat je kunt maken.</p>' +
        '<button type="button" class="btn btn-primary" data-goto="voorraad">Naar mijn voorraad</button></div>';
      return;
    }

    var f = state.make;
    var q = norm(f.search);
    var ranked = rank().filter(function (e) {
      var r = e.recipe;
      if (f.category && r.category !== f.category) return false;
      if (f.maxMissing !== 'any' && e.missing.length > Number(f.maxMissing)) return false;
      if (q && norm(r.name).indexOf(q) === -1 && norm(r.cuisine).indexOf(q) === -1) return false;
      return true;
    });

    var canMake = ranked.filter(function (e) { return e.missing.length === 0; }).length;
    counter.innerHTML = plural(ranked.length, 'recept', 'recepten') +
      (canMake ? ' &middot; <strong>' + canMake + '</strong> direct te maken' : '');

    if (!ranked.length) {
      list.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>Geen recepten gevonden</h3>' +
        '<p>Pas de filters aan of voeg meer ingrediënten toe aan je voorraad.</p></div>';
      return;
    }

    list.innerHTML = ranked.map(makeCardHtml).join('');
  }

  function metaHtml(r) {
    var tags = [];
    if (r.cuisine) tags.push('<span class="tag">' + esc(r.cuisine) + '</span>');
    if (r.category) tags.push('<span class="tag">' + esc(r.category) + '</span>');
    if (r.time) tags.push('<span class="tag">&#9201; ' + esc(r.time) + ' min</span>');
    if (r.servings) tags.push('<span class="tag">' + esc(plural(Number(r.servings), 'persoon', 'personen')) + '</span>');
    if (r.custom) tags.push('<span class="tag tag-custom">Eigen recept</span>');
    return '<div class="meta">' + tags.join('') + '</div>';
  }

  function matchBarHtml(pct) {
    var cls = pct >= 75 ? '' : (pct >= 40 ? ' mid' : ' low');
    return '<div class="match"><div class="match-bar" role="presentation"><div class="match-fill' + cls + '" style="width:' + pct + '%"></div></div>' +
      '<span class="match-pct">' + pct + '%</span></div>';
  }

  function makeCardHtml(e) {
    var r = e.recipe;
    var pct = pctOf(e);
    var haveHtml = e.have.length
      ? '<p class="ing-summary have"><span class="lbl">Heb je:</span> ' + e.have.map(esc).join(', ') + '</p>'
      : '<p class="ing-summary have"><span class="lbl">Heb je:</span> nog niets</p>';
    var missHtml = e.missing.length
      ? '<p class="ing-summary missing"><span class="lbl">Mist nog:</span> ' +
        e.missing.map(function (m) { return '<span class="miss-item">' + esc(m) + '</span>'; }).join(' ') + '</p>'
      : '<p class="all-have">&#10003; Je hebt alles in huis!</p>';
    return '<button type="button" class="recipe-card" data-action="open-recipe" data-id="' + esc(r.id) + '"' +
      ' aria-label="' + esc(r.name + ', ' + pct + '% match, ' + plural(e.missing.length, 'ingrediënt', 'ingrediënten') + ' ontbreekt') + '">' +
      '<h3>' + esc(r.name) + '</h3>' + metaHtml(r) + matchBarHtml(pct) + haveHtml + missHtml + '</button>';
  }

  /* ======================================================================
     View: Recepten
     ====================================================================== */
  function renderRecipes() {
    var f = state.rec;
    var q = norm(f.search);
    var list = state.recipes.filter(function (r) {
      if (f.category && r.category !== f.category) return false;
      if (!q) return true;
      if (norm(r.name).indexOf(q) !== -1 || norm(r.cuisine).indexOf(q) !== -1) return true;
      return (r.ingredients || []).some(function (i) { return norm(i.name).indexOf(q) !== -1; });
    }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'nl'); });

    $('#rec-counter').textContent = plural(list.length, 'recept', 'recepten');

    var el = $('#rec-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>Geen recepten gevonden</h3>' +
        '<p>Probeer een andere zoekterm of voeg zelf een recept toe.</p>' +
        '<button type="button" class="btn btn-primary" data-action="new-recipe">+ Nieuw recept</button></div>';
      return;
    }
    el.innerHTML = list.map(function (r) {
      var ings = (r.ingredients || []).map(function (i) { return i.name; });
      var preview = ings.slice(0, 6).map(esc).join(', ') + (ings.length > 6 ? ', &hellip;' : '');
      return '<button type="button" class="recipe-card" data-action="open-recipe" data-id="' + esc(r.id) + '">' +
        '<h3>' + esc(r.name) + '</h3>' + metaHtml(r) +
        '<p class="ing-summary"><span class="lbl">' + plural(ings.length, 'ingrediënt', 'ingrediënten') + ':</span> ' + preview + '</p>' +
        '</button>';
    }).join('');
  }

  /* ======================================================================
     Dialogen
     ====================================================================== */
  function openDialog(dlg) {
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
  }
  function closeDialog(dlg) {
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }

  function openDetail(id) {
    state.detailId = id;
    if (!renderDetail()) return;
    openDialog($('#detail-dialog'));
    var btn = $('#detail-dialog [data-close]');
    if (btn) btn.focus();
  }

  function renderDetail() {
    var r = findRecipe(state.detailId);
    if (!r) { closeDialog($('#detail-dialog')); state.detailId = null; return false; }
    $('#detail-title').textContent = r.name;

    var st = stapleSet();
    var pn = pantryNormSet();
    var missing = [];

    var ingsHtml = (r.ingredients || []).map(function (i) {
      var n = norm(i.name);
      var status, label;
      if (st.has(n)) { status = 'basis'; label = 'Basis'; }
      else if (pn.has(n)) { status = 'have'; label = 'Heb je'; }
      else { status = 'missing'; label = 'Mist'; missing.push(i.name); }
      return '<li class="li-' + status + '">' +
        '<span class="status status-' + status + '">' + label + '</span>' +
        '<span class="ing-name">' + esc(i.name) + '</span>' +
        (i.amount ? '<span class="ing-amount">' + esc(i.amount) + '</span>' : '') +
        (status === 'missing'
          ? '<button type="button" class="btn btn-ghost btn-sm" data-action="add-missing" data-name="' + esc(i.name) + '">+ Toevoegen aan voorraad</button>'
          : '') +
        '</li>';
    }).join('');

    var steps = (r.steps || []).filter(function (s) { return String(s).trim(); });
    var stepsHtml = steps.length
      ? '<ol class="steps">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>'
      : '<p>Geen bereidingsstappen.</p>';

    var total = (r.ingredients || []).filter(function (i) { return !st.has(norm(i.name)); }).length;
    var have = total - missing.length;
    var pct = total ? Math.round(have / total * 100) : 100;

    var actions = [];
    if (missing.length > 1) {
      actions.push('<button type="button" class="btn btn-primary" data-action="add-all-missing">Alle ontbrekende toevoegen (' + missing.length + ')</button>');
    }
    if (r.custom) {
      actions.push('<button type="button" class="btn btn-ghost" data-action="edit-recipe" data-id="' + esc(r.id) + '">Bewerken</button>');
      actions.push('<button type="button" class="btn btn-danger-ghost" data-action="delete-recipe" data-id="' + esc(r.id) + '">Verwijderen</button>');
    }

    $('#detail-body').innerHTML =
      metaHtml(r) +
      '<div class="detail-section">' + matchBarHtml(pct) +
      '<p class="counter">' + (missing.length
        ? 'Je mist nog ' + plural(missing.length, 'ingrediënt', 'ingrediënten') + '.'
        : 'Je hebt alles in huis!') + '</p></div>' +
      '<section class="detail-section"><h3>Ingrediënten</h3><ul class="detail-ings">' + ingsHtml + '</ul></section>' +
      '<section class="detail-section"><h3>Bereiding</h3>' + stepsHtml + '</section>' +
      (actions.length ? '<div class="detail-actions">' + actions.join('') + '</div>' : '');
    return true;
  }

  /* Zet ingrediënt in voorraad; voegt het eerst toe als het onbekend is */
  function addToPantry(name) {
    var ing = findIngredient(name);
    var p;
    if (ing) {
      p = DB.setInPantry(ing.name, true).then(function () { return ing.name; });
    } else {
      p = DB.addIngredient({ name: name, category: 'Overig' })
        .catch(function () { /* bestaat mogelijk al */ })
        .then(function () { return DB.setInPantry(name, true); })
        .then(function () { return name; });
    }
    return p;
  }

  function addMissing(names) {
    Promise.all(names.map(addToPantry)).then(function () {
      return loadAll();
    }).then(function () {
      toast(names.length === 1 ? '“' + names[0] + '” toegevoegd aan je voorraad.' : plural(names.length, 'ingrediënt', 'ingrediënten') + ' toegevoegd aan je voorraad.');
      var next = $('#detail-body [data-action="add-missing"]') || $('#detail-dialog [data-close]');
      if (next) next.focus();
    }).catch(function (err) { toast('Toevoegen mislukt: ' + errMsg(err), 'error'); });
  }

  function deleteRecipe(id) {
    var r = findRecipe(id);
    if (!r) return;
    if (!window.confirm('Recept “' + r.name + '” verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
    DB.deleteRecipe(r.id).then(function () {
      closeDialog($('#detail-dialog'));
      state.detailId = null;
      return loadAll();
    }).then(function () { toast('Recept verwijderd.'); })
      .catch(function (err) { toast('Verwijderen mislukt: ' + errMsg(err), 'error'); });
  }

  /* ======================================================================
     Receptformulier
     ====================================================================== */
  var rowSeq = 0;

  function addIngredientRow(data, focus) {
    rowSeq++;
    var row = document.createElement('div');
    row.className = 'ing-row';
    var nameId = 'rf-ing-name-' + rowSeq, amtId = 'rf-ing-amt-' + rowSeq;
    row.innerHTML =
      '<div class="field ing-name-field"><label for="' + nameId + '">Ingrediënt</label>' +
      '<input type="text" id="' + nameId + '" class="rf-ing-name" list="known-ingredients" maxlength="60" autocomplete="off"></div>' +
      '<div class="field"><label for="' + amtId + '">Hoeveelheid</label>' +
      '<input type="text" id="' + amtId + '" class="rf-ing-amount" maxlength="40" placeholder="Bijv. 200 g" autocomplete="off"></div>' +
      '<button type="button" class="icon-btn" data-action="remove-ing-row" aria-label="Ingrediënt verwijderen">&times;</button>';
    $('.rf-ing-name', row).value = (data && data.name) || '';
    $('.rf-ing-amount', row).value = (data && data.amount) || '';
    $('#rf-ingredients').appendChild(row);
    if (focus) $('.rf-ing-name', row).focus();
  }

  function openRecipeForm(recipe) {
    state.editingId = recipe ? recipe.id : null;
    var form = $('#recipe-form');
    form.reset();
    $all('.invalid', form).forEach(function (el) { el.classList.remove('invalid'); });
    $('#form-errors').hidden = true;
    $('#form-title').textContent = recipe ? 'Recept bewerken' : 'Nieuw recept';
    fillSelect($('#rf-category'), recipeCategories());

    $('#rf-name').value = recipe ? recipe.name : '';
    $('#rf-cuisine').value = recipe ? (recipe.cuisine || '') : '';
    $('#rf-category').value = recipe ? recipe.category : 'Diner';
    $('#rf-time').value = recipe ? recipe.time : 30;
    $('#rf-servings').value = recipe ? recipe.servings : 2;
    $('#rf-steps').value = recipe ? (recipe.steps || []).join('\n') : '';

    $('#rf-ingredients').innerHTML = '';
    var ings = recipe && recipe.ingredients && recipe.ingredients.length ? recipe.ingredients : [{}, {}, {}];
    ings.forEach(function (i) { addIngredientRow(i, false); });

    if ($('#detail-dialog').open) closeDialog($('#detail-dialog'));
    openDialog($('#form-dialog'));
    $('#rf-name').focus();
  }

  function collectForm() {
    var errors = [];
    var invalid = [];
    var name = $('#rf-name').value.trim();
    var cuisine = $('#rf-cuisine').value.trim();
    var category = $('#rf-category').value;
    var time = Number($('#rf-time').value);
    var servings = Number($('#rf-servings').value);

    if (!name) { errors.push('Geef het recept een naam.'); invalid.push($('#rf-name')); }
    if (!category) { errors.push('Kies een categorie.'); invalid.push($('#rf-category')); }
    if (!isFinite(time) || time <= 0 || Math.round(time) !== time) { errors.push('Bereidingstijd moet een heel getal groter dan 0 zijn.'); invalid.push($('#rf-time')); }
    if (!isFinite(servings) || servings < 1 || Math.round(servings) !== servings) { errors.push('Aantal personen moet een heel getal van minimaal 1 zijn.'); invalid.push($('#rf-servings')); }

    var ingredients = [];
    var seen = new Set();
    var dupes = [];
    $all('#rf-ingredients .ing-row').forEach(function (row) {
      var nEl = $('.rf-ing-name', row);
      var n = nEl.value.trim().replace(/\s+/g, ' ');
      var a = $('.rf-ing-amount', row).value.trim();
      if (!n) {
        if (a) { invalid.push(nEl); errors.push('Een hoeveelheid zonder ingrediëntnaam is ingevuld.'); }
        return;
      }
      var known = findIngredient(n);
      if (known) n = known.name; // canonieke schrijfwijze
      if (seen.has(norm(n))) { dupes.push(n); invalid.push(nEl); return; }
      seen.add(norm(n));
      ingredients.push({ name: n, amount: a });
    });
    if (!ingredients.length) { errors.push('Voeg minstens één ingrediënt toe.'); var first = $('#rf-ingredients .rf-ing-name'); if (first) invalid.push(first); }
    if (dupes.length) errors.push('Dubbel ingrediënt: ' + dupes.join(', ') + '.');

    var steps = $('#rf-steps').value.split(/\r?\n/).map(function (s) {
      return s.trim().replace(/^\d+[.)]\s*/, '');
    }).filter(Boolean);
    if (!steps.length) { errors.push('Beschrijf minstens één bereidingsstap.'); invalid.push($('#rf-steps')); }

    return {
      errors: errors,
      invalid: invalid,
      recipe: {
        name: name, cuisine: cuisine, category: category,
        time: time, servings: servings,
        ingredients: ingredients, steps: steps, custom: true
      }
    };
  }

  function showFormErrors(errors) {
    var box = $('#form-errors');
    // dubbele meldingen samenvoegen
    var uniq = errors.filter(function (e, i) { return errors.indexOf(e) === i; });
    box.innerHTML = 'Controleer het formulier:<ul>' + uniq.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  function submitRecipe(e) {
    e.preventDefault();
    var form = $('#recipe-form');
    $all('.invalid', form).forEach(function (el) { el.classList.remove('invalid'); });
    $('#form-errors').hidden = true;

    var res = collectForm();
    if (res.errors.length) {
      res.invalid.forEach(function (el) { el.classList.add('invalid'); });
      showFormErrors(res.errors);
      if (res.invalid[0]) res.invalid[0].focus();
      return;
    }

    var recipe = res.recipe;
    var editing = state.editingId != null;
    var submitBtn = $('button[type="submit"]', form);
    submitBtn.disabled = true;

    // Onbekende ingrediënten toevoegen aan de lijst (fouten negeren)
    var unknown = recipe.ingredients.filter(function (i) { return !findIngredient(i.name); });
    var pre = Promise.all(unknown.map(function (i) {
      return DB.addIngredient({ name: i.name, category: 'Overig' }).catch(function () { /* negeren */ });
    }));

    var savedId;
    pre.then(function () {
      if (editing) {
        recipe.id = state.editingId;
        return DB.updateRecipe(recipe).then(function () { return recipe.id; });
      }
      return DB.addRecipe(recipe);
    }).then(function (id) {
      savedId = id;
      closeDialog($('#form-dialog'));
      state.editingId = null;
      return loadAll();
    }).then(function () {
      toast(editing ? 'Recept bijgewerkt.' : 'Recept “' + recipe.name + '” toegevoegd.');
      if (savedId != null) openDetail(savedId);
    }).catch(function (err) {
      showFormErrors([errMsg(err)]);
    }).then(function () {
      submitBtn.disabled = false;
    });
  }

  /* ======================================================================
     Import / export / reset
     ====================================================================== */
  function exportData() {
    DB.exportData().then(function (data) {
      var json = JSON.stringify(data, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var d = new Date();
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      a.href = url;
      a.download = 'voorraadkast-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('Gegevens geëxporteerd.');
    }).catch(function (err) { toast('Exporteren mislukt: ' + errMsg(err), 'error'); });
  }

  function importFile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(reader.result); } catch (e) {
        toast('Dit bestand is geen geldige JSON.', 'error');
        input.value = '';
        return;
      }
      if (!window.confirm('Importeren vervangt je huidige gegevens. Doorgaan?')) { input.value = ''; return; }
      DB.importData(obj).then(loadAll).then(function () {
        toast('Gegevens geïmporteerd.');
      }).catch(function (err) {
        toast('Importeren mislukt: ' + errMsg(err), 'error');
      }).then(function () { input.value = ''; });
    };
    reader.onerror = function () { toast('Bestand kon niet worden gelezen.', 'error'); input.value = ''; };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!window.confirm('Alles resetten? Je voorraad, eigen ingrediënten en eigen recepten worden gewist en de standaardgegevens worden teruggezet.')) return;
    DB.resetAll().then(function () {
      state.collapsed.clear();
      return loadAll();
    }).then(function () { toast('Alles is teruggezet.'); })
      .catch(function (err) { toast('Resetten mislukt: ' + errMsg(err), 'error'); });
  }

  /* ======================================================================
     Events (delegatie)
     ====================================================================== */
  function onClick(e) {
    var t = e.target;

    var tabBtn = t.closest('.tab');
    if (tabBtn) { setTab(tabBtn.getAttribute('data-tab'), false); return; }

    var gotoBtn = t.closest('[data-goto]');
    if (gotoBtn) { setTab(gotoBtn.getAttribute('data-goto'), true); return; }

    var closeBtn = t.closest('[data-close]');
    if (closeBtn) { closeDialog(closeBtn.closest('dialog')); return; }

    var el = t.closest('[data-action]');
    if (!el || !state.ready) return;
    var action = el.getAttribute('data-action');

    switch (action) {
      case 'toggle-ing': toggleIngredient(el); break;
      case 'toggle-cat': {
        var cat = el.getAttribute('data-cat');
        var expanded = el.getAttribute('aria-expanded') === 'true';
        el.setAttribute('aria-expanded', String(!expanded));
        var panel = document.getElementById(el.getAttribute('aria-controls'));
        if (panel) panel.hidden = expanded;
        if (expanded) state.collapsed.add(cat); else state.collapsed.delete(cat);
        break;
      }
      case 'open-recipe': openDetail(el.getAttribute('data-id')); break;
      case 'add-missing': addMissing([el.getAttribute('data-name')]); break;
      case 'add-all-missing': {
        var names = $all('#detail-body [data-action="add-missing"]').map(function (b) { return b.getAttribute('data-name'); });
        if (names.length) addMissing(names);
        break;
      }
      case 'edit-recipe': {
        var r = findRecipe(el.getAttribute('data-id'));
        if (r) openRecipeForm(r);
        break;
      }
      case 'delete-recipe': deleteRecipe(el.getAttribute('data-id')); break;
      case 'new-recipe': openRecipeForm(null); break;
      case 'remove-ing-row': {
        var row = el.closest('.ing-row');
        var rows = $all('#rf-ingredients .ing-row');
        if (rows.length <= 1) {
          $all('input', row).forEach(function (i) { i.value = ''; });
          $('.rf-ing-name', row).focus();
        } else {
          var idx = rows.indexOf(row);
          row.parentNode.removeChild(row);
          var remaining = $all('#rf-ingredients .rf-ing-name');
          var target = remaining[Math.min(idx, remaining.length - 1)];
          if (target) target.focus();
        }
        break;
      }
    }
  }

  function bindEvents() {
    document.addEventListener('click', onClick);

    // Klik op de backdrop sluit een dialoog
    $all('dialog').forEach(function (dlg) {
      dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDialog(dlg); });
    });
    $('#detail-dialog').addEventListener('close', function () { state.detailId = null; });
    $('#form-dialog').addEventListener('close', function () { state.editingId = null; });

    // Pijltjestoetsen tussen tabs
    $('.tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var tabs = $all('.tab');
      var i = tabs.indexOf(document.activeElement);
      if (i === -1) return;
      var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      setTab(next.getAttribute('data-tab'), false);
      e.preventDefault();
    });

    $('#pantry-search').addEventListener('input', function (e) {
      state.pantrySearch = e.target.value;
      renderPantry();
    });
    $('#expand-all').addEventListener('click', function () { state.collapsed.clear(); renderPantry(); });
    $('#collapse-all').addEventListener('click', function () {
      ingredientCategoriesInUse().forEach(function (c) { state.collapsed.add(c); });
      renderPantry();
    });
    $('#clear-pantry').addEventListener('click', clearPantry);
    $('#add-ingredient-form').addEventListener('submit', addCustomIngredient);

    $('#make-search').addEventListener('input', function (e) { state.make.search = e.target.value; renderMake(); });
    $('#make-cat').addEventListener('change', function (e) { state.make.category = e.target.value; renderMake(); });
    $('#make-max').addEventListener('change', function (e) { state.make.maxMissing = e.target.value; renderMake(); });

    $('#rec-search').addEventListener('input', function (e) { state.rec.search = e.target.value; renderRecipes(); });
    $('#rec-cat').addEventListener('change', function (e) { state.rec.category = e.target.value; renderRecipes(); });
    $('#new-recipe').addEventListener('click', function () { if (state.ready) openRecipeForm(null); });

    $('#rf-add-ing').addEventListener('click', function () { addIngredientRow(null, true); });
    $('#recipe-form').addEventListener('submit', submitRecipe);

    $('#export-btn').addEventListener('click', function () { if (state.ready) exportData(); });
    $('#import-file').addEventListener('change', function (e) { if (state.ready) importFile(e.target); });
    $('#reset-btn').addEventListener('click', function () { if (state.ready) resetAll(); });
  }

  /* ======================================================================
     Start
     ====================================================================== */
  function start() {
    bindEvents();
    var saved = storageGet(TAB_KEY);
    setTab(TABS.indexOf(saved) !== -1 ? saved : 'voorraad', false);

    var loading = $('#loading');

    if (!window.indexedDB) {
      loading.hidden = true;
      showError('Je browser ondersteunt geen IndexedDB (of het is uitgeschakeld, bijvoorbeeld in privémodus). Gegevens kunnen niet worden opgeslagen.');
      return;
    }
    if (!window.DB) {
      loading.hidden = true;
      showError('De database-module kon niet worden geladen. Controleer of js/db.js aanwezig is.');
      return;
    }

    Promise.resolve()
      .then(function () { return DB.init(); })
      .then(loadAll)
      .then(function () {
        state.ready = true;
        loading.hidden = true;
        renderAll();
      })
      .catch(function (err) {
        console.error(err);
        loading.hidden = true;
        showError('Er ging iets mis bij het starten van de database: ' + errMsg(err));
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
