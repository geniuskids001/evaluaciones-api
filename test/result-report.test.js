const test = require('node:test');
const assert = require('node:assert/strict');
const { computePrimaryDimensions, emailContent } = require('../src/modules/sessions/result-report.service');

test('computes one principal dimension from the highest raw score', () => {
  const result = computePrimaryDimensions([
    { id_dimension: 1, nombre: 'Naranja', valor: 8, porcentaje: 80 },
    { id_dimension: 2, nombre: 'Azul', valor: 2, porcentaje: 20 }
  ]);
  assert.deepEqual(result.map((dimension) => dimension.nombre), ['Naranja']);
});

test('returns tied principal dimensions', () => {
  const result = computePrimaryDimensions([
    { id_dimension: 1, nombre: 'Naranja', valor: 5, porcentaje: 50 },
    { id_dimension: 2, nombre: 'Azul', valor: 5, porcentaje: 50 },
    { id_dimension: 3, nombre: 'Verde', valor: 1, porcentaje: 10 }
  ]);
  assert.deepEqual(result.map((dimension) => dimension.nombre), ['Naranja', 'Azul']);
});

test('does not add dimension content to emails when a test has no dimensions', () => {
  const content = emailContent({
    name: 'Participante',
    sessionName: 'Sesión',
    evaluationName: 'Test',
    snapshot: { puntaje_correctas: 4, puntaje_maximo: 5, dimensiones: [] }
  });
  assert.equal(Object.hasOwn(content, 'attachments'), false);
  assert.match(content.html, /Tus resultados están listos/);
  assert.doesNotMatch(content.html, /Dimensión principal|Resultados por dimensión|Adjuntamos un PDF/);
});

test('shows principal dimension above the static email chart', () => {
  const content = emailContent({
    name: 'Participante',
    sessionName: 'Sesión',
    evaluationName: 'Test',
    snapshot: {
      puntaje_correctas: 4,
      puntaje_maximo: 5,
      dimensiones: [
        { id_dimension: 1, nombre: 'Naranja', valor: 8, porcentaje: 80, color: '#FF8800' },
        { id_dimension: 2, nombre: 'Azul', valor: 2, porcentaje: 20, color: '#2244AA' }
      ]
    }
  });
  assert.match(content.html, /Dimensión principal/);
  assert.match(content.html, /Naranja/);
  assert.match(content.html, /Resultados por dimensión/);
  assert.ok(content.html.indexOf('Dimensión principal') < content.html.indexOf('Resultados por dimensión'));
  assert.match(content.html, /width:80%/);
  assert.doesNotMatch(content.html, /Adjuntamos un PDF/);
});

test('labels tied principal dimensions in plural', () => {
  const content = emailContent({
    name: 'Participante',
    sessionName: 'Sesión',
    evaluationName: 'Test',
    snapshot: {
      dimensiones: [
        { id_dimension: 1, nombre: 'Naranja', valor: 5, porcentaje: 50 },
        { id_dimension: 2, nombre: 'Azul', valor: 5, porcentaje: 50 }
      ]
    }
  });
  assert.match(content.html, /Dimensiones principales/);
  assert.match(content.html, /Naranja, Azul/);
});
