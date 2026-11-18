/**
 * PipeFlow Neige — liaison Google Sheets.
 *
 * À coller dans le classeur : Extensions → Apps Script → Code.gs,
 * puis Déployer → Nouveau déploiement → Application Web
 *   - Exécuter en tant que : Moi
 *   - Accès : Tout le monde
 * et copier l'URL (…/exec) dans PipeFlow Neige → Réglages → Google Sheets.
 *
 * Sécurité (recommandé) : Paramètres du projet → Propriétés du script →
 * ajouter API_KEY = <mot de passe>, et saisir la même clé dans l'application.
 */

/** Onglets échangés lors du chargement du réseau. */
var NETWORK_SHEETS = ['Noeuds', 'Canalisations', 'Calques', 'Catalogue_Tuyaux', 'Modeles_Enneigeurs', 'Scenarios', 'Parametres'];

/** Colonnes toujours écrites en texte brut (évite les conversions en date / nombre). */
var TEXT_COLUMNS = ['id', 'nom', 'amont', 'aval', 'geometrie', 'notes', 'calque', 'aspiration', 'secteur', 'couronnes', 'priorite', 'noeud_id', 'scenario', 'ref', 'modele', 'cle', 'valeur', 'description', 'couleur'];

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Requête JSON invalide' });
  }
  return handle_(body);
}

function handle_(req) {
  try {
    checkKey_(req.key);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    switch (req.action) {
      case 'ping':
        return json_({ ok: true, data: { title: ss.getName(), sheets: ss.getSheets().map(function (s) { return s.getName(); }) } });
      case 'load': {
        var data = {};
        NETWORK_SHEETS.forEach(function (name) {
          var sh = ss.getSheetByName(name);
          data[name] = sh ? readSheet_(sh) : [];
        });
        return json_({ ok: true, data: data });
      }
      case 'save': {
        var lock = LockService.getScriptLock();
        lock.waitLock(30000);
        try {
          var names = Object.keys(req.data || {});
          names.forEach(function (name) {
            writeSheet_(ss, name, req.data[name] || []);
          });
          return json_({ ok: true, data: { saved: names } });
        } finally {
          lock.releaseLock();
        }
      }
      default:
        throw new Error('Action inconnue : ' + req.action);
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function checkKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (expected && key !== expected) throw new Error("Clé d'accès invalide (API_KEY).");
}

function readSheet_(sh) {
  var values = sh.getDataRange().getValues();
  if (values.length < 1) return [];
  var head = values[0].map(String);
  return values
    .slice(1)
    .filter(function (r) {
      return r.some(function (c) { return c !== '' && c !== null; });
    })
    .map(function (r) {
      var o = {};
      head.forEach(function (h, i) {
        if (!h) return;
        o[h] = r[i] instanceof Date ? r[i].toISOString() : r[i];
      });
      return o;
    });
}

function writeSheet_(ss, name, rows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  // On conserve l'ordre des colonnes existantes et on ajoute les nouvelles à droite.
  var lastCol = sh.getLastColumn();
  var head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(function (h) { return h; }) : [];
  rows.forEach(function (r) {
    Object.keys(r).forEach(function (k) {
      if (head.indexOf(k) < 0) head.push(k);
    });
  });
  if (!head.length) return;
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);

  var maxRows = sh.getMaxRows();
  if (maxRows > 1) sh.getRange(2, 1, maxRows - 1, Math.max(head.length, sh.getLastColumn(), 1)).clearContent();
  if (!rows.length) return;

  var needed = rows.length + 1;
  if (sh.getMaxRows() < needed) sh.insertRowsAfter(sh.getMaxRows(), needed - sh.getMaxRows());

  head.forEach(function (h, i) {
    if (TEXT_COLUMNS.indexOf(h) >= 0) sh.getRange(2, i + 1, rows.length, 1).setNumberFormat('@');
  });
  var values = rows.map(function (r) {
    return head.map(function (h) {
      var v = r[h];
      if (v === undefined || v === null) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
  });
  sh.getRange(2, 1, values.length, head.length).setValues(values);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
