const ROLE_CAPABILITIES = Object.freeze({
  superadmin: Object.freeze([
    'evaluaciones:manage',
    'sesiones:manage:any',
    'usuarios:manage',
    'papelera:manage:any'
  ]),
  admin: Object.freeze([
    'sesiones:manage:own',
    'papelera:manage:own'
  ])
});

function capabilitiesFor(role) {
  return ROLE_CAPABILITIES[role] || [];
}

module.exports = { ROLE_CAPABILITIES, capabilitiesFor };
