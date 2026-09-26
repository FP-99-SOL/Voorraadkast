/*
 * Voorraadkast - database laag (IndexedDB)
 *
 * Classic script (geen ES module). Definieert window.DB.
 * Verwacht optioneel window.SEED_INGREDIENTS en window.SEED_RECIPES (data/seed.js).
 */
(function () {
  'use strict';

  var DB_NAME = 'voorraadkast';
  var DB_VERSION = 1;
  var STORES = ['ingredients', 'recipes', 'pantry', 'meta'];

  var dbPromise = null; // gedeelde open-verbinding

  /* ---------- Kleine promise helpers ---------- */

  // Zet een IDBRequest om in een Promise met het resultaat.
  function req(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  // Resolve wanneer een transactie volledig is gecommit.
  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('Transactie afgebroken')); };
    });
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB wordt niet ondersteund door deze browser.'));
        return;
      }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains('ingredients')) db.createObjectStore('ingredients', { keyPath: 'name' });
        if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('pantry')) db.createObjectStore('pantry', { keyPath: 'name' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { dbPromise = null; reject(request.error); };
      request.onblocked = function () { console.warn('Voorraadkast: database open geblokkeerd door ander tabblad.'); };
    });
    return dbPromise;
  }

  // Start een transactie; geeft {tx, stores} terug.
  function tx(storeNames, mode) {
    return openDB().then(function (db) {
      var t = db.transaction(storeNames, mode || 'readonly');
      var names = Array.isArray(storeNames) ? storeNames : [storeNames];
      var stores = {};
      names.forEach(function (n) { stores[n] = t.objectStore(n); });
      return { tx: t, stores: stores };
    });
  }

  function getAll(storeName) {
    return tx(storeName).then(function (o) { return req(o.stores[storeName].getAll()); });
  }

  /* ---------- Normalisatie ---------- */

  function normName(name) {
    return String(name == null ? '' : name).trim().toLowerCase();
  }

  function byName(a, b) {
    return String(a.name || '').localeCompare(String(b.name || ''), 'nl', { sensitivity: 'base' });
  }

  function nowIso() { return new Date().toISOString(); }

  // Maak een schoon ingrediëntrecord.
  function cleanIngredient(ing) {
    return {
      name: normName(ing.name),
      category: (ing.category && String(ing.category).trim()) || 'Overig',
      staple: !!ing.staple
    };
  }

  // Valideer en normaliseer een recept (zonder id/custom/createdAt).
  function cleanRecipe(recipe) {
    if (!recipe || typeof recipe !== 'object') throw new Error('Ongeldig recept.');
    var name = String(recipe.name == null ? '' : recipe.name).trim();
    if (!name) throw new Error('Een recept moet een naam hebben.');
    var seen = {};
    var ingredients = (Array.isArray(recipe.ingredients) ? recipe.ingredients : [])
      .map(function (i) {
        if (typeof i === 'string') i = { name: i, amount: '' };
        return { name: normName(i && i.name), amount: String((i && i.amount) == null ? '' : i.amount).trim() };
      })
      .filter(function (i) {
        if (!i.name || seen[i.name]) return false;
        seen[i.name] = true;
        return true;
      });
    if (!ingredients.length) throw new Error('Een recept moet minstens één ingrediënt hebben.');
    var steps = (Array.isArray(recipe.steps) ? recipe.steps : [])
      .map(function (s) { return String(s == null ? '' : s).trim(); })
      .filter(Boolean);
    var time = Number(recipe.time);
    var servings = Number(recipe.servings);
    return {
      name: name,
      cuisine: String(recipe.cuisine || '').trim(),
      category: String(recipe.category || '').trim(),
      time: isFinite(time) && time > 0 ? time : 0,
      servings: isFinite(servings) && servings > 0 ? servings : 0,
      ingredients: ingredients,
      steps: steps
    };
  }

  // Voeg in een lopende transactie ontbrekende ingrediënten toe (categorie "Overig").
  // `known` is een object-set van bestaande namen en wordt bijgewerkt.
  function putMissingIngredients(ingStore, recipe, known) {
    recipe.ingredients.forEach(function (i) {
      if (!known[i.name]) {
        known[i.name] = true;
        ingStore.put({ name: i.name, category: 'Overig', staple: false });
      }
    });
  }

  /* ---------- Seeding ---------- */

  function seedArrays() {
    return {
      ingredients: Array.isArray(window.SEED_INGREDIENTS) ? window.SEED_INGREDIENTS : [],
      recipes: Array.isArray(window.SEED_RECIPES) ? window.SEED_RECIPES : []
    };
  }

  // Vult ingredients + recipes vanuit SEED_* en zet meta.seeded. Eén transactie.
  function seed() {
    var seedData = seedArrays();
    return tx(['ingredients', 'recipes', 'meta'], 'readwrite').then(function (o) {
      var known = {};
      seedData.ingredients.forEach(function (ing) {
        if (!ing || !ing.name) return;
        var rec = cleanIngredient(ing);
        if (known[rec.name]) return;
        known[rec.name] = true;
        o.stores.ingredients.put(rec);
      });
      var created = nowIso();
      seedData.recipes.forEach(function (r) {
        var clean;
        try { clean = cleanRecipe(r); } catch (e) {
          console.warn('Voorraadkast: seed-recept overgeslagen:', r && r.name, e.message);
          return;
        }
        putMissingIngredients(o.stores.ingredients, clean, known);
        clean.custom = false;
        clean.createdAt = created;
        o.stores.recipes.add(clean);
      });
      o.stores.meta.put({ key: 'seeded', value: true });
      return txDone(o.tx);
    });
  }

  /* ---------- Publieke API ---------- */

  var DB = {};

  DB.init = function () {
    return openDB()
      .then(function () { return tx('meta'); })
      .then(function (o) { return req(o.stores.meta.get('seeded')); })
      .then(function (rec) {
        if (!rec || !rec.value) return seed();
      })
      .then(function () { return true; });
  };

  DB.getIngredients = function () {
    return getAll('ingredients').then(function (list) { return list.sort(byName); });
  };

  DB.addIngredient = function (ing) {
    ing = ing || {};
    var rec = cleanIngredient(ing);
    if (!rec.name) return Promise.reject(new Error('Een ingrediënt moet een naam hebben.'));
    return tx('ingredients', 'readwrite').then(function (o) {
      var result = rec;
      return req(o.stores.ingredients.get(rec.name)).then(function (existing) {
        if (existing) result = existing;
        else o.stores.ingredients.add(rec);
        return txDone(o.tx);
      }).then(function () { return result; });
    });
  };

  DB.getPantry = function () {
    return getAll('pantry').then(function (list) {
      return list.map(function (p) { return p.name; });
    });
  };

  DB.setInPantry = function (name, present) {
    var n = normName(name);
    if (!n) return Promise.resolve();
    return tx('pantry', 'readwrite').then(function (o) {
      if (present) {
        o.stores.pantry.get(n).onsuccess = function (e) {
          if (!e.target.result) o.stores.pantry.put({ name: n, addedAt: nowIso() });
        };
      } else {
        o.stores.pantry.delete(n);
      }
      return txDone(o.tx);
    });
  };

  DB.clearPantry = function () {
    return tx('pantry', 'readwrite').then(function (o) {
      o.stores.pantry.clear();
      return txDone(o.tx);
    });
  };

  DB.getRecipes = function () {
    return getAll('recipes').then(function (list) { return list.sort(byName); });
  };

  DB.getRecipe = function (id) {
    return tx('recipes').then(function (o) { return req(o.stores.recipes.get(Number(id))); });
  };

  DB.addRecipe = function (recipe) {
    var clean;
    try { clean = cleanRecipe(recipe); } catch (e) { return Promise.reject(e); }
    clean.custom = true;
    clean.createdAt = nowIso();
    return DB.getIngredients().then(function (ings) {
      var known = {};
      ings.forEach(function (i) { known[i.name] = true; });
      return tx(['ingredients', 'recipes'], 'readwrite').then(function (o) {
        putMissingIngredients(o.stores.ingredients, clean, known);
        var newId;
        o.stores.recipes.add(clean).onsuccess = function (e) { newId = e.target.result; };
        return txDone(o.tx).then(function () { return newId; });
      });
    });
  };

  DB.updateRecipe = function (recipe) {
    if (!recipe || recipe.id == null) return Promise.reject(new Error('Recept zonder id kan niet worden bijgewerkt.'));
    var id = Number(recipe.id);
    var clean;
    try { clean = cleanRecipe(recipe); } catch (e) { return Promise.reject(e); }
    return Promise.all([DB.getIngredients(), DB.getRecipe(id)]).then(function (res) {
      var existing = res[1];
      if (!existing) throw new Error('Recept niet gevonden.');
      var known = {};
      res[0].forEach(function (i) { known[i.name] = true; });
      clean.id = id;
      clean.custom = recipe.custom != null ? !!recipe.custom : !!existing.custom;
      clean.createdAt = existing.createdAt || nowIso();
      clean.updatedAt = nowIso();
      return tx(['ingredients', 'recipes'], 'readwrite').then(function (o) {
        putMissingIngredients(o.stores.ingredients, clean, known);
        o.stores.recipes.put(clean);
        return txDone(o.tx).then(function () { return id; });
      });
    });
  };

  DB.deleteRecipe = function (id) {
    return tx('recipes', 'readwrite').then(function (o) {
      o.stores.recipes.delete(Number(id));
      return txDone(o.tx);
    });
  };

  DB.exportData = function () {
    return Promise.all([getAll('ingredients'), getAll('recipes'), getAll('pantry')]).then(function (r) {
      return {
        version: 1,
        exportedAt: nowIso(),
        ingredients: r[0].sort(byName),
        recipes: r[1].sort(byName),
        pantry: r[2]
      };
    });
  };

  DB.importData = function (obj) {
    // Validatie: gooit Error met Nederlandse melding.
    var data;
    try {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Het bestand bevat geen geldig Voorraadkast-object.');
      if (obj.version != null && Number(obj.version) !== 1) throw new Error('Onbekende versie van het exportbestand (' + obj.version + ').');
      if (!Array.isArray(obj.ingredients)) throw new Error('Het veld "ingredients" ontbreekt of is geen lijst.');
      if (!Array.isArray(obj.recipes)) throw new Error('Het veld "recipes" ontbreekt of is geen lijst.');
      if (obj.pantry != null && !Array.isArray(obj.pantry)) throw new Error('Het veld "pantry" is geen lijst.');

      var ingredients = obj.ingredients.map(function (i, idx) {
        if (!i || typeof i !== 'object' || !normName(i.name)) throw new Error('Ingrediënt ' + (idx + 1) + ' heeft geen geldige naam.');
        return cleanIngredient(i);
      });
      var recipes = obj.recipes.map(function (r, idx) {
        var clean;
        try { clean = cleanRecipe(r); } catch (e) {
          throw new Error('Recept ' + (idx + 1) + (r && r.name ? ' ("' + r.name + '")' : '') + ' is ongeldig: ' + e.message);
        }
        var id = Number(r.id);
        if (r.id != null && isFinite(id) && id > 0) clean.id = id;
        clean.custom = !!r.custom;
        clean.createdAt = r.createdAt ? String(r.createdAt) : nowIso();
        if (r.updatedAt) clean.updatedAt = String(r.updatedAt);
        return clean;
      });
      var pantry = (obj.pantry || []).map(function (p) {
        var name = normName(typeof p === 'string' ? p : p && p.name);
        return name ? { name: name, addedAt: (p && p.addedAt) ? String(p.addedAt) : nowIso() } : null;
      }).filter(Boolean);
      data = { ingredients: ingredients, recipes: recipes, pantry: pantry };
    } catch (e) {
      return Promise.reject(e);
    }

    return tx(STORES, 'readwrite').then(function (o) {
      o.stores.ingredients.clear();
      o.stores.recipes.clear();
      o.stores.pantry.clear();
      var known = {};
      data.ingredients.forEach(function (i) { known[i.name] = true; o.stores.ingredients.put(i); });
      data.recipes.forEach(function (r) {
        putMissingIngredients(o.stores.ingredients, r, known);
        o.stores.recipes.put(r); // id wordt automatisch toegekend als het ontbreekt
      });
      data.pantry.forEach(function (p) { o.stores.pantry.put(p); });
      o.stores.meta.put({ key: 'seeded', value: true }); // voorkomt her-seeden bij volgende init
      return txDone(o.tx);
    });
  };

  DB.resetAll = function () {
    return tx(STORES, 'readwrite').then(function (o) {
      STORES.forEach(function (s) { o.stores[s].clear(); });
      return txDone(o.tx);
    }).then(seed);
  };

  /*
   * Synchroon, puur: rangschikt recepten op basis van de voorraad.
   * - recipes: array van recepten
   * - pantryNames: array (of Set) van ingrediëntnamen in de voorraad
   * - ingredients: array van ingrediëntrecords (voor de staple-vlag)
   */
  DB.rankRecipes = function (recipes, pantryNames, ingredients) {
    var staples = {};
    (ingredients || []).forEach(function (i) {
      if (i && i.staple) staples[normName(i.name)] = true;
    });
    var pantry = {};
    var pList = pantryNames instanceof Set ? Array.from(pantryNames) : (pantryNames || []);
    pList.forEach(function (n) { pantry[normName(n)] = true; });

    var results = [];
    (recipes || []).forEach(function (recipe) {
      var seen = {};
      var needed = [];
      (recipe.ingredients || []).forEach(function (i) {
        var n = normName(i && i.name);
        if (!n || staples[n] || seen[n]) return;
        seen[n] = true;
        needed.push(n);
      });
      var have = needed.filter(function (n) { return pantry[n]; });
      var missing = needed.filter(function (n) { return !pantry[n]; });
      if (have.length === 0 && needed.length !== 0) return;
      results.push({
        recipe: recipe,
        have: have,
        missing: missing,
        matchPct: needed.length ? Math.round(100 * have.length / needed.length) : 100
      });
    });

    results.sort(function (a, b) {
      return (a.missing.length - b.missing.length) ||
        (b.matchPct - a.matchPct) ||
        (b.have.length - a.have.length) ||
        byName(a.recipe, b.recipe);
    });
    return results;
  };

  window.DB = DB;
})();
