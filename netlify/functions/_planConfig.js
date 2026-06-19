// netlify/functions/_planConfig.js
// Capa de planes del lado SERVER (espeja PLAN_FEATURES del front). Single source of truth
// para las functions: modo de Embi por plan, trial, label, y normalización de valores viejos.
const PLAN_SERVER = {
  esencial: { label: 'Esencial', embi: 'explicativo', trial: true },
  pro:      { label: 'Pro',      embi: 'operativo',   trial: true },
  premium:  { label: 'Premium',  embi: 'operativo',   trial: true }
};

const TRIAL_DIAS = 10;

// Mapea valores viejos/desconocidos al set nuevo. Default seguro = 'esencial'.
function normalizarPlan(valor) {
  const v = (valor || '').toString().toLowerCase().trim();
  if (v === 'base' || v === 'esencial') return 'esencial';
  if (v === 'pro') return 'pro';
  if (v === 'premium') return 'premium';
  return 'esencial'; // 'business' (inerte), vacío, desconocido → esencial
}

module.exports = { PLAN_SERVER, TRIAL_DIAS, normalizarPlan };
