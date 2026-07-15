# INVENTARIO FUNCIONAL — MB Strategy (app cliente)

> **Qué es esto.** Referencia compacta de "qué existe" en el sistema: cada vista/modal, qué acciones ofrece (botones, toggles, selectores, campos), qué condiciones (rol / plan / estado) las muestran u ocultan, y qué colecciones/campos escribe o lee. Es la contraparte descriptiva del mapa de doctrinas (el "por qué"). Generado recorriendo `index.html` módulo por módulo — sin tocar código.
>
> **Arquitectura.** SPA de archivo único (`index.html`, ~36k líneas). Multi-tenant: casi todo vive bajo `clientes/{clienteId}/<subcolección>` (`currentClientUID` = tenant activo). Excepciones top-level filtradas por campo `uid`: `configuracionCierre`, `cierres`, `cobros`. Navegación cliente: `showClientMod(mod)` (módulo del topbar/sidebar) → `showCTab(tab)` (vista `ct-<tab>`) + `load<Módulo>()`.

## Mapa de módulos (sidebar cliente)

| Módulo (label) | Interno | Sub-vistas (`ct-*`) | Gating de plan |
|---|---|---|---|
| **Inicio** | `inicio` | `ct-inicio` | — (solo dueño/admin lo ve) |
| **Finanzas** | `finanzas` | Caja `ct-contabilidad`, Auditoría cajas `ct-auditoria-cajero`, Cierre de período `ct-cierre-periodo`, Configuración `ct-caja-config`, Mis Facturas `ct-mis-facturas`, Resumen Ventas `ct-resumen-ventas`, Resumen Compras `ct-resumen-compras` | Auditoría = Pro (`auditoriaCajero`); resto en los 3 planes |
| **Comercial** | `ventas` | Clientes `ct-mclientes`, Cobranzas `ct-cobranzas`, Presupuestos `ct-presupuestos`, Catálogo `ct-productos` | 3 planes |
| **Compras** | `compras` | Proveedores/CC `ct-proveedores`, Necesidades `ct-necesidades`, Órdenes `ct-ordenes-compra`, Historial `ct-historial-compra`, Productos `ct-prod-compra`, Categorías `ct-categorias-compra` | 3 planes |
| **Stock** | `stock` | Insumos `ct-insumos`, Productos `ct-productos-stock`, Recetas `ct-recetas`, Movimientos `ct-movimientos-stock` | Pro (`stock`) |
| **Producción** | `produccion` | `ct-produccion` | Premium (`produccion`) |
| **Control del negocio** | `herramientas` | Calculador `ct-calculador`, Indicadores `ct-kpis` | 3 planes |
| **Gestión** | `gestion` | Plan de acción `ct-tareas` | 3 planes |
| **Mi cuenta** (footer) | — | `ct-micuenta`, `ct-membresia` | — |
| **Equipo** (footer) | — | `ct-equipo` | solo admin; cajas = Pro, multicaja = Premium |

**Roles del sistema:** `admin` (dueño, ve todo), `cajero` (circuito mostrador, tabs limitados), `comercial`, `compras`, `vendedor`, `produccion`, `stock`. Un operador puede tener varios roles; los mixtos cajero+sistema eligen "modo caja" vs "modo sistema" al entrar. Detalle completo de la matriz rol→módulos/tabs y plan→features en la sección **Mi cuenta · Equipo · Roles y planes**.

## Índice

1. [Inicio](#inicio)
2. [Finanzas — Caja / Auditoría](#finanzas--caja)
3. [Finanzas — Configuración / Cierre de período](#finanzas--configuración-y-cierre-de-período)
4. [Finanzas — Mis Facturas / Resúmenes](#finanzas--mis-facturas--resumen-ventas--resumen-compras)
5. [Comercial — Clientes / Cobranzas](#05--comercial-label-visible--ventas-interno--clientes--cobranzas)
6. [Comercial — Presupuestos / Catálogo](#06--comercial-presupuestos-y-catálogo-de-precios)
7. [Compras](#módulo-compras--indexhtml)
8. [Stock / Producción](#08--stock-y-producción)
9. [Control del negocio / Gestión](#control-del-negocio--gestión)
10. [Mi cuenta · Equipo · Roles y planes](#10--mi-cuenta--equipo--roles-y-planes)
11. [Circuito Cajero](#circuito-cajero-rol-cajero)

---


## Inicio
**Vista:** `ct-inicio` (HTML ~2840-2970) · función `loadInicio` (línea 18161) · router en `showClientMod('inicio')` → `showCTab('inicio')`+`loadInicio()` (línea 31295)
**Lee:** `currentClientData` (doc `clientes/{uid}`) · subcolecciones `clientes/{uid}/`: `alertas`, `insumos`, `libroCaja`, `cuentas`, `misClientes`, `proveedores`, `ordenesCompra`, `facturas`, `embiNotificaciones`, `operadores` · top-level `configuracionCierre` (query `where uid==`) · `window._`: `_cajaSaldoTotal`, `_reservaTotal`, `_cuentasDuenoNombres`, `_clientPresupuestos`, `_clientTareas`/`_paTareas`, `_stockInsumos`, `_mcClientes`, `_proveedores`, `_ordenesCompra`, `_ultimoCierreDoc` · helpers `preloadCajaSaldo`, `_calcularPorPagar`, `_getUltimoCierre`, `getPresupMonto`, `_esCuentaDueno`, `_calcularSaldoCuenta`
**Visibilidad del módulo:** solo admin/dueño. `_MOD_POR_ROL` (línea 33367) da `admin:null` (sin filtro) pero **ningún rol operador incluye `'inicio'`** (comercial→ventas, compras→compras, vendedor→ventas+finanzas, produccion, stock); `tieneAccesoAModulo('inicio')` es `false` para operadores. Todos los planes lo listan (`esencial`/`pro`/`premium`, línea 33393+), el gate real es el rol.

### Banner — cabecera
- logo `#inicio-logo-wrap` → `<img>` · fuente `currentClientData.logoNegocio` · [si existe; si no, ícono SVG genérico]
- `#inicio-negocio-nombre` → nombre del negocio · fuente `currentClientData.negocioNombre` ‖ `.nombre` ‖ `'Mi negocio'`
- `#inicio-fecha` → "Lunes 14 de julio, 2026" · `new Date()` (cliente)
- pill salud `#inicio-salud-pill` → check + mensaje · fuente cálculo salud (ver abajo) · [siempre `inline-flex` tras cálculo; card contenedora `#inicio-salud-card` queda oculta]

### Banner — KPIs (`#inicio-kpis`)
- `Disponible` `#client-disponible` → "Caja + Reservas" · `_cajaSaldoTotal + _reservaTotal` seteado por `preloadCajaSaldo` (línea 12916); saldos = suma de cuentas donde `_esCuentaDueno` + cuentas `tipo==='reserva'`, saldo por cuenta vía `_calcularSaldoCuenta(nombre, libroCaja)`
- `Resultado en curso` `#inicio-resultado` → `_disponible − _porPagar` · `_disponible = _cajaSaldoTotal`; `_porPagar = Σ saldo` de `_calcularPorPagar(uid)` · `animateCounter`
- `Reserva` `#inicio-reserva` → `_reservaTotal` (cuentas `tipo==='reserva'`)
- `Por cobrar` `#inicio-por-cobrar` → Σ `getPresupMonto(p)` de `_clientPresupuestos` con `estado==='Aprobado'` (carga con `loadClientPresupuestos` si vacío)
- `Por pagar` `#inicio-por-pagar` → `_porPagar` (mismo Σ de `_calcularPorPagar`)
- Nota: control cruzado `Resultado en curso + Reserva = Disponible`. Cards de Ganancia/Egresos/Margen del mes calendario **calculadas pero ya NO renderizadas** (migradas a Indicadores; consts vivas, sin escritura de DOM) — línea 18309.

### Banner — barra de período del mes
- `#inicio-dias-num` + `#inicio-dias-start/end`, `#inicio-mes-bar` → días restantes del mes calendario y % transcurrido (`diaActual/totalDias`) · `new Date()`, sin Firestore · anima flip/width (IIFE línea 18183)

### Banner — Ciclo actual (`#inicio-ciclo-wrap`)
- `#inicio-ciclo-desde` → "comenzó el DD/MM" · `_getUltimoCierre(uid).fechaFin` (→ `window._ultimoCierreDoc`); si no hay cierre = "el inicio"
- `Ingresos del ciclo` `#inicio-ciclo-ing` → Σ `libroCaja` ingresos con `cuenta ∈ _cuentasDuenoNombres` y `fecha > fechaFin` del último cierre
- `Egresos del ciclo` `#inicio-ciclo-eg` → ídem egresos, excluyendo `esRetiroSocio` (retiros de socio no son egreso operativo)
- pill `#inicio-ver-cierre-pill` `Ver cierre anterior` → `abrirModalCierreAnterior()` · [display solo si existe `ultimoCierre`]

### Banner — Accesos directos (`#inicio-accesos-grid`, estáticos)
- `Cta. cte. clientes` → `abrirReporteClientes()`
- `Stock` → `sidebarNav('stock','productos')`
- `Cta. cte. proveedores` → `inicioReporteProv()`

### Onboarding checklist (`#onboarding-checklist` · `renderOnboardingChecklist` línea 18773)
Banner "Configurá tu cuenta", barra `done/4`. Al completar los 4 → oculta, `updateDoc onboardingCompletado:true` y `closeWelcomeScreen()`. Steps y qué los marca:
- `Datos del negocio` → `openModal('miCuentaModal')` · ok si `negocioNombre` && `logoNegocio` && `negocioEmail` (todos en `currentClientData`)
- `Datos fiscales` → `openModal('miCuentaModal')` · ok si `negocioCuit` && `negocioPuntoVenta` && `negocioCondicionIVA`
- `Configurar el cierre de período` → `sidebarNav('finanzas','caja-config')` + `cprdShowCfgTab('cierre')` · ok si existe doc en `configuracionCierre where uid==uid`
- `Mi equipo` → `navigateToEquipo()` · ok si subcolección `operadores` no vacía
- [se muestra solo mientras `done<4`; re-render también desde líneas 25427/26033]

### Alertas del sistema (`#inicio-alertas-sistema`)
- 1 card por doc de `clientes/{uid}/alertas` con `leida==false` (ordenadas por `fecha` desc) · texto `a.mensaje` · botón × → `marcarAlertaLeida(id)` · [display solo si hay ≥1]
- append dinámico `#alerta-cobranza-venc` → "N presupuestos aprobados sin cobrar hace +7 días" · fuente `_clientPresupuestos` estado `Aprobado` con `fecha/creadoEn` > 7 días · botón `Ver Cobranzas` → `sidebarNav('comercial','cobranzas')`

### Stock crítico (`#inicio-stock-critico`)
- "N insumos con stock crítico" + nombres · fuente `_stockInsumos` (o query `insumos where activo==true`) filtrando `stockMinimo>0 && stockActual<=stockMinimo` · botón `Ver insumos →` → `sidebarNav('stock','insumos')` · [display solo si hay críticos]

### Salud del negocio (cálculo → pill `#inicio-salud-pill`)
Basado en `totalIngMes`/`totalEgMes`/`margen`/`porCobrar` del mes calendario (de `libroCaja`, filtro por campo `mes`):
- rojo "Los egresos superan los ingresos este mes" · si `totalEgMes > totalIngMes`
- ámbar "Margen bajo — revisá tus costos" ‖ "Hay cobros pendientes altos" · si `margen<20` ‖ `porCobrar > totalIngMes*0.5`
- verde "Negocio en buen estado este mes" · resto

### Alertas inteligentes (`#inicio-alertas` · array `alertas[]` con `accionLabel`/`accionFn`)
Cada card: título, subtítulo, monto, botón `accionLabel`→`accionFn`. Tipos: `urgente` (no descartable), `atencion` (descarta 7d), `positiva` (descarta 24h). Descartes en `localStorage mb_dismissed_alertas_{uid}` vía `dismissAlerta`.
- **MB Strategy notif** → `dismissEmbiNotif(id)` (`Entendido`) · por doc `embiNotificaciones` con `leido` falsy · tag Notificación
- **Cobros pendientes** (`cobros-venc`) → `showClientMod('ventas');showCTab('presupuestos')` (`Ver presupuestos`) · si hay `_clientPresupuestos` estado `Aprobado`; monto = Σ `getPresupMonto` · tag Urgente
- **Egresos > ingresos** (`eg-sup-ing`) → `showClientMod('finanzas')` (`Ver egresos`) · si `totalEgMes>totalIngMes && totalIngMes>0` · tag Urgente
- **Presupuestos por enviar** (`presup-por-enviar`) → `showClientMod('ventas');showCTab('presupuestos')` (`Ver presupuestos`) · estado `Pendiente de enviar` (dismiss forzado a limpiarse) · tag Urgente
- **Presupuestos sin respuesta** (`presup-sin-resp`) → `showClientMod('ventas')` (`Hacer seguimiento`) · estado `Enviado` con `fecha` > 7 días · tag Atención
- **Margen cayó** (`margen-cayo`) → `showClientMod('finanzas')` (`Ver finanzas`) · si `margenAnt−margen > 20` && `gananciaAnt>0` · tag Atención
- **Récord de ingresos** (`record-ing-YYYY-M`) → `showClientMod('finanzas')` (`Ver finanzas`) · si `totalIngMes>totalIngAnt && totalIngAnt>0` · tag Positivo
- **Tarea vence hoy/mañana** (`tarea-venc`) → `showCTab('tareas')` (`Ver plan de acción`) · fuente `_clientTareas`/`_paTareas` con `fechaVenc<=mañana` y `estado!=='done'` · tag Atención
- Vacío → "Todo al día — tu negocio está en orden"

### Facturación del mes (`#inicio-facturacion-mes`)
- "N facturas por $X emitidas este mes" · query `facturas orderBy creadoEn desc limit 200`, filtra `creadoEn` mes actual, Σ `importeTotal` · [display solo si hay ≥1 factura del mes]

### Actividad reciente (`#inicio-actividad`)
- feed de últimos 5 eventos (ordenados por `creadoEn` desc) mezclando: `libroCaja` ingresos/egresos, `_clientPresupuestos` (por estado), `misClientes`, `proveedores`, `ordenesCompra` (emitida/pagada) · ícono/color por subtipo · link `Ver todo →` → `navigateToHistorial()`


---


# Finanzas — Caja y Auditoría de cajas mostrador (vista dueño/admin)

## Finanzas — Caja
**Vista:** `ct-contabilidad` (~L3002, banner "Mis cajas") · `loadCajaModule` (L12684)
**Ruta:** sidebar `finanzas/caja` → `showClientContView('caja')` (L35137)
**Lee:** `clientes/{id}/cuentas` (`nombre`, `tipo`=efectivo|mp|banco|reserva|retiros, `orden`), `clientes/{id}/libroCaja`, `clientes/{id}/facturas` (para badge facturado; `movId`/`ticketNum`→`nroComprobante`,`puntoVenta`), `clientes/{id}/operadores` (activo→alias "Caja general"), `clientes/{id}/cajas` (dropdown filtro origen).
**Escribe:** `clientes/{id}/libroCaja` (alta y edición de movimientos; borrado lógico).

### Modelo `libroCaja` (campos leídos/escritos)
- `tipo`: `ingreso` | `egreso` | `transfer` (entre cuentas) | `transferencia` (legacy) | `pedido_cta`
- `monto`, `concepto`, `detalle`, `fecha` (YYYY-MM-DD), `mes` ("Mes de AAAA"), `hora`, `creadoEn` (ISO), `creadoPor` (nombre operador o 'Admin')
- `cuenta` (ingreso/egreso) · `cuentaDesde`/`cuentaHacia` (transfer)
- `origen`: `manual` | `venta_caja` | `venta_caja_espejo` | `devolucion_caja*` | `cobro_cliente` | `apertura_turno` | `cierre_turno` | `retiro_cajero`/`_cierre` | `egreso_cajero` | `deposito_cajero` | `caja_cajero`
- `eliminado` (bool, borrado lógico) · `uid`
- Caja física/turno: `cajaId`, `cajaOrigenId`, `cajaOrigenNombre`, `turnoId`, `medioPago` (Efectivo/Mercado Pago/Transferencia/Tarjeta*)
- Venta/factura: `productos[]` (`nombre`,`qty`,`precioUnitario`), `ticketNum`, `refMovId`, `facturado`, `facturaId`, `clienteNombre`
- Cierre efectivo (arqueo dueño): `montoContado`, `saldoEsperado`

### Saldo por cuenta — helper único `_calcularSaldoCuenta(nombre, movs)` (L17057)
`+monto` si `ingreso`&`cuenta==n`; `-monto` si `egreso`&`cuenta==n`; transfer: `+` a `cuentaHacia`, `-` a `cuentaDesde`. Ignora `eliminado`.
`_esCuentaDueno(c)` (L12888): cuenta del dueño = tipo efectivo/banco/mp (o legacy Efectivo/Banco/Mercado Pago sin tipo), **excluye** `'Caja mostrador'` y `reserva`.

### KPIs — `renderCajaKPIs(movs)` (L12801)
Se calculan sobre los movimientos filtrados. Ocultos en grid `caja-kpi-grid` (display:none) pero alimentan cards/banner.
- `Entradas` (`caja-kpi-entradas`) → Σ `monto` de `tipo==ingreso`
- `Salidas` (`caja-kpi-salidas`) → Σ `egreso` + `transfer` con `cuentaHacia` que empieza `"Retiros "`
- `Resultado` (`caja-kpi-resultado`) → Entradas − Salidas · verde/rojo según signo · [wrap oculto para rol cajero]
- Saldo dueño `window._cajaSaldoTotal` (banner "Todas") = Σ saldos de cuentas `_esCuentaDueno` · pintado en `cont-disponible`
- (rol cajero: `caja-kpi-saldo-final`/`saldo-cajero` = apertura de turno + resultado — no aplica a dueño)

### Cards de cuentas — `renderCajaCuentasCards()` (L12647), contenedor `caja-cuentas-cards`
Card "Todas" (Σ saldos) + una card por cuenta: saldo (`_calcularSaldoCuenta`), nº movimientos, barra %. Click = filtra por cuenta (`cajaFiltrarCuenta`).

### Chips de cuenta — `renderCajaChips(cuentas, movs)` (L12834), contenedor `caja-chips`
Chip "Todas" + chip por cuenta (dueño ve todas **menos** 'Caja mostrador'; dot color por tipo efectivo/mp/banco). Alias: `Efectivo`→"Caja general" si hay operadores activos.
- `chip Todas / <cuenta>` → `cajaFiltrarCuenta(nombre|null,el)` (L12922) · setea `_cajaCuentaFiltro`, resetea paginación 15, re-aplica filtros

### Barra de filtros (una línea, ~L3064)
- `Filtrar por fecha` (`caja-rango-btn`) → calendario custom rango (máx 31 días); `cajaRangoAplicar`/`Cancelar`/`Limpiar`; shortcuts Hoy/Esta semana/Este mes · setea `_cajaRangoDesde/_Hasta`
- Chips tipo `Todos`/`Ingresos`/`Egresos` (`cfil-*`) → `cajaFiltrarTipo(tipo)` (L13459) · filtra la tabla ya renderizada por `data-tipo` (+ búsqueda `cajaFiltrar`)
- `Caja: <origen>` (`caja-filter-origen-wrap`) → dropdown `cajaToggleOrigenDrop`/`cajaSeleccionarOrigen` (L13083): **Todas** / **Solo movimientos del dueño** (`__sin_caja__`, excluye turnoId y orígenes cajero) / una por caja física (`cajaOrigenNombre`) · **[solo `currentRol!=='cajero'`]**
- `_aplicarFiltrosCaja()` (L12961): aplica origen + cuenta + rango; en vista "Todas" default recorta a cuentas del dueño (`_esCuentaDueno`); pagina (`_cajaPaginaLimite`, últimos N=15); dispara KPIs+tabla+chips.

### Tabla de movimientos — `renderCajaTable(paginados, facturadosMap, filtradosBanner)` (L13112), `caja-tbody`
Columnas (fila = card clickeable, `onclick=cajaMostrarMovimiento(id)`): barra color por tipo · **Fecha** · **Concepto** (+sub `cajaOrigenNombre` si dueño) · **Cuenta** (chip; transfer muestra `desde → hacia`) · **Monto** (signo/color: ingreso verde +, egreso/transfer-salida marrón −) · **SALDO** acumulado corrido · **icono Factura**.
- Icono factura (solo `tipo==ingreso` no-apertura/cierre/retiro): si ya facturado→check con nº; si no→`abrirModalFacturaCaja(movId)` (L13328) emite AFIP vía `/.netlify/functions/afip`, escribe `facturas` y marca `libroCaja.facturado/facturaId`
- Banner `caja-totales-banner`: TOTAL / TOTAL DEL PERÍODO (si hay filtros) con Entradas/Salidas/Saldo (sobre `filtradosForBanner`, no paginados)
- `caja-cargar-mas-row` → `cajaCargarMasAntiguos()` (L13027) +15 · [oculto para cajero]
- Empty state distinto para dueño (onboarding "Configurar cuentas"/"Registrar primer movimiento")

### Botón "+ Movimiento" y modal
Header `caja-plus-btn` → menú `caja-plus-menu`: opción **Movimiento** → `cajaNuevoMovimiento()` (L17099). Botón export `caja-dl-btn` → `exportarCajaExcel`/`exportarCajaCsv`. En Home hay `cv-btn cv-btn-mov` "+ Movimiento" (L11900; cajero ve "Depósito" en su lugar).
- `cajaNuevoMovimiento` (L17099): **[`return` si `currentRol==='cajero'`]** — este modal es solo dueño/admin. Carga `cuentas`+`conceptos`+`libroCaja`; abre overlay `mvm-overlay`.
- Modal (`_mvmRenderCuentas` L17161 excluye 'Caja mostrador' de los selects):
  - **Tipo** (`mvm-tipo-*`): Ingreso / Egreso / Transferencia — `mvmSetTipo` (L17172)
  - Ingreso/Egreso: **Concepto** (`mvm-concepto-sec`, de subcol `conceptos` filtrados por tipo) · **Monto** (`mvm-monto`) · **Cuenta** (`mvm-cuenta`) · **Fecha** (`mvm-fecha`) · **Detalle**
  - Concepto especial **"Cierre de caja"** (solo cuenta `tipo==efectivo`): campo Contado (`mvm-contado`) → arqueo; escribe `egreso` "Cierre de caja" con `montoContado`/`saldoEsperado` y, si difiere, auto-genera `Sobrante` (ingreso) o `Faltante` (egreso)
  - Transferencia (espejo entre cuentas): **Desde** (`mvm-tr-desde`) · **Hacia** (`mvm-tr-hacia`) · **Monto** · **Fecha** · **Detalle** → doc `tipo:'transfer'`, concepto "Transferencia entre cuentas"
- **Guardar** `mvmGuardar()` (L17375): valida cuenta obligatoria + `_validarCuentaExiste` (anti-huérfanos, L17078), desde≠hacia; `addDoc` a `libroCaja` con `origen:'manual'`, `creadoPor`; recarga `loadCajaModule`.

### Modal detalle / editar / eliminar — `cajaMostrarMovimiento(id)` (L13738), overlay `mdv-overlay`
Lee `cuentas`+`conceptos`; render por tipo (transfer / venta_caja / espejo / normal). Muestra Fecha, Concepto/Total, Cuenta, Detalle, Productos, badge facturado.
- **Editar** `mdvGuardar()` (L13990): edita `fecha`,`monto`,`concepto`,`detalle` (recalcula `mes`); **la `cuenta`/`cuentaDesde`/`cuentaHacia` NO es editable** (blindaje anti-huérfano/descuadre); `updateDoc` libroCaja
- **Eliminar** `mdvEliminar()` (L13977): `showConfirm` → `updateDoc {eliminado:true}` (borrado lógico) → recarga
- Espejo `venta_caja_espejo`: botón **Facturar** → `abrirModalFacturaCaja`

---

## Finanzas — Auditoría de cajas mostrador
**Vista:** `ct-auditoria-cajero` (L3616, root `#auditoria-cajero-root`) · `loadAuditoriaCajero` (L12046)
**Gating:** plan **Pro**, feature `auditoriaCajero` (registro L31418 `{feat:'auditoriaCajero',plan:'pro'}`; carga condicionada `if(tieneAccesoPlan('auditoriaCajero')) loadAuditoriaCajero()` L35143). En matriz de planes: explicativo=false, operativo/pro=true (L33394-33400).
**Rol:** vista del dueño/admin. **Solo lectura** — no escribe en Firestore (los movimientos los generó el circuito cajero); clicks abren el detalle read-only.
**Lee:** `libroCaja` (`where eliminado==false, orderBy creadoEn desc, limit 500`), `cajas` (físicas), `turnos` (`where estado=='abierto'`), `operadores` (solo `rol=='cajero'`).

### Filtrado base (`_auditoriaRender` L12150)
Solo movs de **cajas físicas**: `cajaId` || `cajaOrigenId` || (`cuenta` matchea nombre de caja física, fallback legacy). Estado inicial `_auditoriaFiltro='hoy'`.

### Header KPIs por medio (banner "Cajas mostrador")
Totales de **ingresos** del período por `medioPago`, con nº mvtos y barra %:
- `Efectivo` · `Mercado Pago` · `Transferencia` · `Tarjeta` (medioPago empieza "Tarjeta") · **Egresos** (Σ `egreso`, excluye `cierre_turno`)
- Click en un medio → `_auditoriaFiltroMedio` filtra **solo la tabla** (no los totales)
- Título cambia a "Caja <nombre>" si hay caja seleccionada

### Filtros de fecha (chips header)
- `Todo` / `Hoy` / `Ayer` → `_auditoriaFiltro`, filtra por `m.fecha`
- **`En curso`** → `_auditoriaActivarEncurso()` (L12096): 2 `onSnapshot` en tiempo real (turnos abiertos + libroCaja); muestra movs de turnos abiertos (`turnoId` ∈ abiertos, o apertura por timestamp)
- `custom` (input date) → `_auditoriaFechaCustom`

### Dropdowns (línea 1)
- **Caja:** `aud-caja-btn` → `audToggleCajaDrop`/`audSeleccionarCaja(cajaId)` (L12430): "Todas las cajas" o una física (dot verde = turno abierto) · setea `_auditoriaCajaFiltro`
- **Cajero:** `aud-cajero-btn` → `audToggleCajeroDrop`/`audSeleccionarCajero(nombre)` (L12502): filtra por `m.creadoPor` · **[solo si `_auditoriaOperadores.length>0`]**

### Chips de tipo (línea 2, `_auditoriaTipos` Set)
`Todos` / `Venta caja` (`venta_caja`) / `Cobro CC` (`cobro_cliente`) / `Egreso` (`egreso_cajero`) / `Retiro` (`retiro_cajero`) / `Apertura` (`apertura_turno`) / `Cierre` (`cierre_turno`) — toggle sobre `m.origen`.

### Tabla / Cards
- Tabla (max 200 filas): barra color por tipo · Concepto · fecha·hora·**cajero** (`creadoPor`) · chip `medioPago` · Monto (signo/color por ingreso/pedido_cta/egreso). Fila click → `cajaMostrarMovimiento(id)` (detalle read-only).
- Modo **En curso + Todas las cajas** → `_auditoriaRenderCardsHtml(movs)` (L12511): una card por turno abierto con caja, cajero, hora apertura, tiempo transcurrido, desglose Efectivo/MP y **total en curso** (arqueo vivo). Sin turnos → estado vacío "No hay turnos abiertos ahora".

### Notas
- La doctrina de separación (comentario L12992): la **Caja del dueño** muestra sus cuentas + espejos + retiro por cierre; los primarios del turno del cajero (cuenta `'Caja mostrador'`) viven **únicamente** en Auditoría.
- "Diferencias/arqueos" del cajero: el arqueo formal (Sobrante/Faltante) se ve como movimientos `cierre_turno`/concepto en la tabla; el arqueo del dueño se genera desde el modal +Movimiento → "Cierre de caja" (ver arriba).


---


# Finanzas — Configuración y Cierre de período

Multi-tenant. Colecciones bajo `clientes/{uid}/…` salvo `configuracionCierre` y `cierres`, que son **top-level con campo `uid`** (filtradas por `where('uid','==',currentClientUID)`).

---

## Finanzas — Configuración
**Vista:** `ct-caja-config` (línea ~3157) · loader Caja: `loadCajaConfig` (línea 14062) · loader Cierre: `loadCierreConfig` (línea 14216)
**2 sub-tabs:** `cprd-cfg-tab-caja` → `cprdShowCfgTab('caja')` · `cprd-cfg-tab-cierre` → `_checkProTab('cierre-config')` → `cprdShowCfgTab('cierre')` (línea 14207; sin candado, universal).

### Sub-tab CAJA (`cprd-cfg-caja-content`) · `loadCajaConfig`
**Lee:** `clientes/{uid}/cuentas`, `clientes/{uid}/conceptos`, `clientes/{uid}/libroCaja` (las 3 en paralelo). `libroCaja` solo se usa para saber qué cuentas/conceptos `tieneMovs` (bloquea edición/borrado); ignora `data.eliminado`. Cuentas ordenadas por `orden`.

#### Bloque Cuentas
- `Agregar cuenta` → `cajaConfigAgregarCuenta()` → modal `ccfg-cuenta-overlay`. Campos: nombre, tipo (segmented `.ccfg-tipo-btn`: efectivo/mp/banco/…), banco (solo si tipo=banco), saldo inicial.
- `Guardar` (crear) → `ccfgCuentaGuardar` (16896) · escribe doc en `cuentas`: `{nombre, tipo, banco?, saldo, orden:snap.size, activa:true}`. Si `saldo>0` además escribe mov `libroCaja`: `{tipo:'ingreso', concepto:'Apertura de caja', cuenta:nombre, monto:saldo, origen:'manual', detalle:'Saldo inicial', mes, eliminado:false, creadoEn, creadoPor}`.
- `Editar` (`ccfgAbrirEditarCuenta`) → solo visible si la cuenta **no tiene movs**. En edición: **nombre readonly + tipo disabled** (inmutables; defensa server-side en guardar rechaza cambio de nombre). Solo actualiza `{banco, saldo}` (saldo solo si no tiene movs; si tiene, campo solo-lectura).
- `Desactivar` (`ccfgDesactivarCuenta`, 16959) → **borra** el doc (`deleteDoc`). Bloqueado si es cuenta base (`window._CUENTAS_BASE = ['Efectivo','Mercado Pago','Banco','Caja mostrador']`, línea 17051) o si `tieneMov`. Botón ocultar solo aparece en cuentas custom sin movs.

#### Bloque Conceptos (ingreso / egreso)
- `Nuevo` → `cajaConfigNuevoConcepto(tipo)` muestra input inline · `cajaConfigConfirmarConcepto` escribe en `conceptos`: `{nombre, tipo, sistema:false}`.
- Conceptos con `sistema:true` → badge "sistema", no editables/borrables.
- `Editar` inline → `ccfgConfirmarEdicionConcepto` · `updateDoc` solo `{nombre}`.
- `Eliminar` → `ccfgEliminarConcepto` · `deleteDoc`; bloqueado si `tieneMov`.

### Sub-tab CIERRE (`cprd-cfg-cierre-content`) · `loadCierreConfig` (14216)
**Lee:** `configuracionCierre` where `uid`==uid (toma `docs[0]`). También `loadProveedores()` para el dropdown de vínculo. **Escribe:** `cprdGuardarConfig` (14403) upsert a `configuracionCierre` + puede crear cuentas de reserva.
Campos leídos del doc: `frecuencia`, `proyeccionHabilitada`, `estructura`, `participantes[]`, `reservas[]`. Defaults si vacío: participantes `[]`, reservas `[{nombre:'Reserva del negocio',pct:15}]`. Espeja `window._cprdParticipantes` (Indicadores lo lee para excluir retiros viejos).

#### Card 1: Frecuencia
- Segmented `cprd-frecuencia-seg` (semanal/quincenal/mensual) → `cprdSelFrec` · estado `_cprdFrecuencia` → guarda `frecuencia`.
- Toggle `cprd-toggle-proy` "Proyección de cierre" → `cprdToggleProy` · estado `_cprdProyeccion` → guarda `proyeccionHabilitada` (si false, el panel de cierre arranca en modo 'real').

#### Card 2: Socios o dueño (participantes)
- Segmented estructura `cprd-estructura-seg` (unico/sociedad) → `cprdSelEstructura` · `_cprdEstructura` → guarda `estructura`. Al elegir 'unico' con lista vacía precarga `{nombre:'Dueño',pct:85}`.
- `Agregar` → `cprdAgregarParticipante` push `{id,nombre:'',pct:0,proveedorId:null}`.
- Por fila: input nombre (`cprdUpdateParticipante`), input `pct` %, select proveedor de vínculo, botón eliminar.
- Select vínculo `cprdSelProveedorParticipante`: vincula `proveedorId` a un proveedor CC existente. Opción "— Crear nuevo —" → `cprdCrearProveedorParticipante` crea doc en `clientes/{uid}/proveedores`: `{nombre:'<nombre> — Retiro socio', categoria:'Retiro socio', creadoEn, eliminado:false}` y lo vincula. Este vínculo es la CC donde se registran los retiros del socio en el cierre real.

#### Card 3: Reservas del negocio
- `Agregar` → `cprdAgregarReserva` push `{nombre:'Nueva reserva',pct:5}`.
- Por fila: nombre (`cprdUpdateReserva`), `pct` %, eliminar.
- Barra distribución `_cprdRenderDistBar`: reservas + participantes + remanente; alerta `cprd-total-alert` si suma >100%.

#### Guardar configuración (`cprd-save-btn` → `cprdGuardarConfig`, 14403)
- Valida total ≤100% (toast si no). Upsert doc `configuracionCierre`: `{uid, frecuencia, proyeccionHabilitada, estructura, participantes, reservas, actualizadoEn}`.
- Post-guardado crea cuentas de reserva faltantes en `clientes/{uid}/cuentas`: por cada reserva con nombre no existente → `{nombre, tipo:'reserva', esReserva:true, saldo:0, orden:200+i, activa:true, creadoEn}`. **Los retiros de socios NO crean caja propia** (viven en la CC del proveedor-socio).

---

## Finanzas — Cierre de período
**Vista:** `ct-cierre-periodo` (línea ~3621) · `loadCierrePeriodo` (línea 14454) · gating: **3 planes** (`PLAN_FEATURES.*.cierrePeriodo:true`, líneas 33395/98/401; sin candado en `_checkProTab`/`_aplicarLocksPlanBase`). Sub-tab del módulo también en línea 2604.
**Lee:** `configuracionCierre` (config), `clientes/{uid}/cuentas`, `clientes/{uid}/libroCaja` (saldos), `clientes/{uid}/proveedores/*/facturas` + `/pagos` (compromisos CC), `cierres` where uid (sugerir fechas / último cierre).
**Escribe (solo en cierre real):** `cierres` (doc), `clientes/{uid}/libroCaja` (movimientos), `clientes/{uid}/proveedores/*/pagos` y `/facturas`, `clientes/{uid}/config/cierres_{año}` (correlativo).

### Carga (`loadCierrePeriodo`)
1. Config: setea `_cierreFrec`, `_cprdProyeccion` (si false → `_cierreModo='real'`), `_cprdParticipantes`, `_cprdReservas`.
2. `_cierreSugerirFechas` (14510): último cierre `estado==='cerrado'` de mayor `fechaFin`; inicio = día siguiente (o hoy−Ndías si no hay). Fin = inicio + {sem:7/quin:15/mens:30}−1, topeado a hoy. Setea `#cierre-fecha-inicio/fin` (`max`=hoy).
3. Cuentas operativas (`_cierreCuentas`): excluye inactivas, tipo `retiros`/`reserva`, y **'Caja mostrador'** (su plata ya entró vía retiro de caja → evita doble conteo).
4. Saldo real por cuenta vía `window._calcularSaldoCuenta(nombre, movsLibroCaja)`; suma = `_cierreDisponibleTotal`.
5. Compromisos (`_cierreCargarCompromisos`): manuales de sesión + CC proveedores con saldo (facturas−pagos)>0 vía `_calcularPorPagar` (14546) → items `{nombre:'<prov> — CC Proveedor', monto:saldo, origen:'proveedor'}`. OCs emitidas **no** se listan (solo son deuda al recibirse, y ahí entran como factura esOC).
6. Distribución (`_cierreDistribucion`): reservas + participantes con su `pct`.

### Panel (3 pasos)
- **Paso 1 — Disponible por cuenta** (auto): lista cuentas con saldoReal + total.
- **Paso 2 — Compromisos**: checkbox por compromiso (`cierreToggleCompromiso` → marca `pagado`). `Agregar compromiso manual` → modal `cierre-compromiso-modal` · `cierreConfirmarCompromisoManual` push `{origen:'manual', pagado:true}` (solo en memoria).
- **Paso 3 — Distribución**: input `%` por reserva/participante (`cierreUpdateDist`). Monto = `(disponible − compromisos pagados) × pct/100`. Barra + error si >100% (deshabilita botón). Cards resumen: Reservas / Retiros / Remanente.
- KPIs hero+footer (`_cierreActualizarTotales`, 14714): Disponible, Compromisos (Σ pagados), A distribuir (`max(0, disponible − pagados)`).

### Modo (proyección / real) · `cierreSetModo` (14796)
- `proyeccion`: notice verde, botón "Guardar proyección". No genera movimientos.
- `real`: notice, botón "Cerrar y generar PDF". Genera movimientos + registra.

### Botones footer
- `Descartar` (`cierreDescartar`) → limpia manuales, recarga.
- `Guardar borrador` (`cierreGuardarBorrador`, 14829) → valida fechas (`_cierreFechasValidas`, 14848), `addDoc` a `cierres` con `_cierreBuildDoc('borrador')`.
- Botón principal (`cierreAccionPrincipal`, 14858): valida fechas; si proyección → `_cierreGuardarProyeccion` (`addDoc cierres` doc estado `'proyeccion'`); si real → `_cierreAbrirRevision` (overlay de reparto por cuenta).

### Documento `cierres` (`_cierreBuildDoc`, 15136)
Campos: `uid`, `tipo` ('cierre' si real, sino el modo), `frecuencia`, `fechaInicio`, `fechaFin`, `disponibleTotal`, `cuentasSnapshot[]` `{nombre,tipo,saldo}`, `compromisos[]`, `distribucion[]`, `remanente` (=`max(0, disponible − compromisos − Σdistribución)`), `estado` ('borrador'|'proyeccion'|'cerrado'), `eliminado:false`, `creadoEn`. En cerrado se agrega `cerradoEn` y `numero`.

### Revisión pre-cierre real (`_cierreAbrirRevision`, 14950)
Overlay `cierre-rev-overlay`: por cada compromiso pagado / ítem de distribución con monto>0, el usuario reparte el monto entre las cuentas operativas (`_cierreRevItems`, inputs es-AR con `_cierreRevNorm/Parse`). Si hay 1 sola cuenta, precarga. `_cierreRevRecalc` valida que cada ítem sume su total y ninguna cuenta quede negativa → habilita "Confirmar y generar PDF" (`cierreConfirmarRevision`, 15096; lock anti-doble-cierre).

### Ejecución del cierre (`_cierreEjecutarCierre`, 14875)
1. **Correlativo** `AÑO-NNNN`: transacción sobre `clientes/{uid}/config/cierres_{año}` campo `ultimo` (+1); `doc_.numero`.
2. `addDoc cierres` (estado `'cerrado'`, `cerradoEn`).
3. **Movimientos** a `libroCaja` (con `uid, fecha, mes, origen:'cierre', referenciaId:cierreRef.id, eliminado:false, creadoPor`):
   - compromiso → `egreso` por cuenta (+`proveedorNombre/Id` si es CC proveedor).
   - reserva → `transfer` `cuentaDesde`→`cuentaHacia:<nombre reserva>`.
   - retiro socio → `egreso` con `esRetiroSocio:true` desde la cuenta real del dueño.
4. **Pagos CC proveedor** (`provPagos`): `addDoc` a `proveedores/{id}/pagos` `{tipo:'pago', monto, medio:'cierre', concepto:'Pago desde cierre de período', …}`.
5. **Retiros socio** (`retiroPagos`, si `participante.proveedorId`): en `proveedores/{provId}` crea **factura** `{numero:'Retiro <mes>', tipoComprobante:'X', desc, monto, montoPagado, estado:'pagada', esOC:false}` **+ pago** por igual monto → deja la CC del socio en cero y acumula el histórico de retiros.
6. Limpia `_cierreManualCompromisos`, bloquea panel (`_cierreRenderBloqueado`: banner éxito, botones "Nuevo cierre"/"Ver PDF", controles disabled), genera PDF.

### PDF (`cierreGenerarPDF`, 15157)
jsPDF (CDN). Lee datos del negocio de `clientes/{uid}` (nombre, tel, email, cuit, rubro, `logoNegocio`). Secciones: Período, Disponible por cuenta, Compromisos pagados, Distribución del resultado, Resumen. Encabezado muestra `N° <numero>` + "Cierre oficial" si `tipo==='cierre'`, sino "Proyección".

### Modal "Cierre anterior" (`abrirModalCierreAnterior`, 14596)
Solo lectura de un doc `cierres` ya cerrado: disponible al cerrar, compromisos pagados, distribución (retiros/reservas), remanente (saldo inicial del próximo período); botón a `cierreGenerarPDF`.


---


# Finanzas — Mis Facturas / Resumen Ventas / Resumen Compras

Documentación de solo-lectura. SPA multi-tenant `clientes/{clienteId}/<subcolección>`. `currentClientUID` es el tenant activo. Facturación disponible en los 3 planes (no hay gate de plan en el tab-switch, ~línea 31461-31463; solo gate de datos fiscales al emitir).

Colecciones involucradas:
- `clientes/{id}/facturas` — comprobantes de venta emitidos (Factura A/B/C). Campos: `tipoComprobante`(1=A,6=B,11=C; 'X'=excluido del resumen), `puntoVenta`, `nroComprobante`, `importeTotal`, `cae`, `caeFechaVto`, `cuitEmisor`, `cuitReceptor`, `razonSocialReceptor`, `condicionIVAReceptor`, `concepto`(1=productos,2=servicios), `descripcion`, `items`[{desc,cantidad,precio}], `ambiente`('homologacion'|producción), `creadoEn`(ISO string, se filtra por `.slice(0,7)`=YYYY-MM), `netoGravado`, `iva`.
- `clientes/{id}/notasCredito` — NC. Campos: `tipoNotaCredito`(3=A,8=B,13=C), `facturaId`(FK a factura), `puntoVenta`, `nroComprobante`, `importeTotal`, `cae`, `caeFechaVto`, `ambiente`, `creadoEn`.
- `clientes/{id}/notasDebito` — ND. Campos: `tipoNotaDebito`(2=A,7=B,12=C), demás igual a NC.
- `clientes/{id}/proveedores/{provId}/facturas` — comprobantes de COMPRA (fuente de Resumen de Compras). Campos: `tipoComprobante`('A'|'C'|'X'|null), `monto`, `netoGravado`, `iva21`, `numeroComprobante`|`numero`, `fecha`, `creadoEn`, `esOC`(bool; true=orden de compra, se excluye), `eliminado`, `desc`.
- Emisión real la hace la Netlify function `/.netlify/functions/afip` (ARCA/AFIP): acciones `emitirFactura`, `emitirNotaCredito`, `emitirNotaDebito`, `ultimoComprobante`. El front NO escribe la factura; la function crea el doc y devuelve `{ok, cae, nroComprobante, facturaId}`.

---

## Finanzas — Mis Facturas
**Vista:** `ct-mis-facturas` (~3288) · `loadMisFacturasModule` (línea 15562) · registro tab `loadMisFacturasModule()` (31461)
**Lee:** `facturas` (query `orderBy('creadoEn','desc') limit(200)`), `notasCredito` (todas), `notasDebito` (todas). Cachea en `window._mfFacturas`, `_mfNcList`, `_mfNdList`.
**Escribe:** nada directo (la emisión va por la function AFIP; sólo `updateDoc` de `items` y de presupuesto tras emitir — ver abajo).

Dos sub-vistas dentro del contenedor: `mf-list-view` (listado) y `nfl-view` (formulario nueva factura libre). Se togglean mostrando/ocultando.

### Banner + KPIs (mes)
- `select#mf-mes-select` → `mfSelectMes(value)` setea `window._mfMesSel` y recarga · opciones = meses distintos presentes en `facturas` + mes actual.
- KPI `#mf-kpi-cantidad` → cantidad de facturas del mes (excluye `tipoComprobante==='X'`).
- KPI `#mf-kpi-total` → `totalBruto − totalNC + totalND` del mes (neteo con NC/ND).
- KPI `#mf-kpi-ultima` → fecha (`creadoEn.slice(0,10)`) de la factura más reciente.

### Botón "+" (menú nueva) `#mf-plus-menu`
- `toggleDropdown('mf-plus-menu')` abre menú.
- `mfNuevoOpcion('factura')` → `abrirNuevaFacturaLibre()` (abre `nfl-view`). Antes valida `_verificarDatosFiscales()`.
- `mfNuevoOpcion('nc')` → abre modal `mf-ncnd-modal` en modo NC.
- `mfNuevoOpcion('nd')` → abre modal `mf-ncnd-modal` en modo ND.

### Botón exportar `#mf-dl-menu`
- `exportarMfExcel()` (16319) → genera `.xlsx` (ExcelJS CDN) con facturas+NC+ND del mes; NC restan (signo −1); neto/iva sólo si RI o si guardados. Lee cache. Sin escritura.
- `exportarMfCsv()` (16417) → `.csv` equivalente. Lee cache.

### Tabla listado `#mf-tabla` / `#mf-tbody`
Columnas: Fecha · Receptor · Tipo · N° Comprobante · Total · Estado · acciones. Solo facturas del mes (`tipoComprobante!=='X'`). Vacío → `#mf-empty`.
- Tipo badge: `{1:'Factura A',6:'B',11:'C'}`. `ambiente==='homologacion'` → badge "homo".
- N° = `PPPP-NNNNNNNN` (puntoVenta 4 díg. + nroComprobante 8 díg.).
- Receptor = `razonSocialReceptor` || `cuitReceptor` || 'Consumidor Final'.
- Estado: siempre "Emitida" (hardcode; no hay estado anulada — se anula vía NC/ND).
- Fila responsive: mobile renderiza card + botón `↓` directo (`descargarPdfFactura`).
- `button` acciones (desktop `mfToggleAcciones(id)`) → menú `#mf-acc-{id}`:
  - `descargarPdfFactura(id)` (15707) → lee `facturas/{id}` + doc cliente; genera PDF con `_generarPdfComprobante` (jsPDF+QR ARCA CDN). Descarga. Sin escritura.
  - `mfWhatsApp(id)` (15377) → arma msg; si el cliente (`_mcClientes` por CUIT) tiene tel abre wa.me; si no, abre modal `mf-wa-modal` para pedir número.
  - `mfEmailModal(id)` (15422) → abre modal `mfEmailModal`, prellena email del cliente.
- Botón expandir `mfToggleSubRow(id)` (15553) → muestra sub-fila `#mf-sub-{id}` con NC/ND imputadas a esa factura (`facturaId===f.id`). Cada NC/ND tiene su menú: `descargarPdfNcNd('notasCredito'|'notasDebito', id)` (15951) y `mfWhatsAppDoc(coleccion,id)` (15396).

### Modal NC/ND `#mf-ncnd-modal` (~6396)
Emite Nota de Crédito (anula/devuelve) o Débito imputada a una factura. Poblado por `mfNuevoOpcion` (15328).
- `select#mf-ncnd-factura-sel` → `mfNcNdSelFactura()` (15482): opciones = facturas del mes con tipo ∈{1,6,11}. Al elegir, muestra `#mf-ncnd-info` (tipo/nro/receptor) y precarga `#mf-ncnd-monto` con `importeTotal`.
- `input#mf-ncnd-monto` → monto del comprobante.
- `input#mf-ncnd-motivo` → motivo (opcional, no se envía a AFIP en el body actual).
- `button#mf-ncnd-btn-emitir` → `mfEmitirNcNd()` (15500):
  - Guard: monto>0, factura seleccionada, y suma de NC/ND ya imputadas < `importeTotal` (bloquea sobre-imputar).
  - Mapea tipo: NC `{1:3,6:8,11:13}`, ND `{1:2,6:7,11:12}`.
  - POST `/.netlify/functions/afip` accion `emitirNotaCredito`/`emitirNotaDebito` con `{puntoVenta, tipoNotaCredito|tipoNotaDebito, importeTotal, caeOriginal, nroComprobanteOriginal, tipoComprobanteOriginal, cuitReceptor, condicionIVAReceptor, facturaId}` + header `Authorization: Bearer <idToken>`, `X-Cliente-UID`.
  - Éxito → toast `CAE`, `closeModal`, `loadMisFacturasModule()`. Error → `traducirErrorAFIP`.

### Modal WhatsApp `#mf-wa-modal` (~7050)
- `input#mf-wa-tel` + `mfConfirmarWa()` (15416) → abre `wa.me/549{tel}` con `_mfWaPendingMsg`.

### Modal Email `#mfEmailModal` (~7035)
- `input#mf-email-destino` + `button#mf-email-btn` → `mfEnviarEmail()` (15439): genera PDF base64 (`_generarPdfComprobante(...,{returnBase64:true})`), POST `/.netlify/functions/send-factura-email` con `{emailDestino, pdfBase64, nombreArchivo, asunto, cuerpo}`. Valida formato email. Sin escritura Firestore.

### Sub-vista Nueva Factura Libre `#nfl-view` (~3366)
Formulario de emisión. Abierto por `abrirNuevaFacturaLibre()` (16023) tras `_verificarDatosFiscales()`.
- **Emisor** (solo lectura): `negocioNombre`, `negocioCuit`, `negocioCondicionIVA` de `currentClientData`.
- **Ítems**: buscador `#nfl-prod-search` → `nflBuscarProducto` (autocompleta de `_productos` activos), `nflSeleccionarProducto` precarga precio. `nflAgregarItem()` (16145) push a `window._nflItems{desc,cantidad,precio}`. `nflQuitarItem`. `nflRenderItems`/`nflRecalcular` (16166) calculan subtotal/IVA/total (neto=total/1.21 si tipo A/B).
- **Condición receptor** pills `.nfl-pill` (data-cond 5=CF,6=Mono,1=RI,4=Exento) → `selectNflCond(el,cond,needCuit)` (16067): setea `dataset.tipoComp` vía `_getMfcTipoComp(emisorCond,cond)`, refetcha número con `_nflActualizarHeader` (16081), muestra `#nfl-receptor-extra` (CUIT+razón social) si needCuit.
- `_updateNflPillLabels` (16058) actualiza labels A/B/C según emisor.
- **Emitir** `button#nfl-btn-emitir` → `emitirFacturaLibre()` (16242):
  - Determina `tipoComprobante`: emisor RI → cond '1'?1:6; exento→6; else 11 (monotributo=C).
  - Guards: total>0, ≥1 ítem, CUIT requerido si cond ∈{6,1,4}.
  - POST afip accion `emitirFactura` con `{puntoVenta, tipoComprobante, importeTotal, concepto:2, condicionIVAReceptor, cuitReceptor, razonSocialReceptor, descripcion, items}`.
  - Éxito → toast CAE. **Escribe**: `updateDoc(facturas/{facturaId},{items})` (guarda renglones); si venía de un presupuesto (`_nflPresupId`): `updateDoc(presupuestos/{id},{nroFactura,facturaId})` y `addDoc(misClientes/{id}/historial,{texto,fecha})`. Vuelve al listado.
- `_nflActualizarHeader(tipoComp)` (15984) → POST afip accion `ultimoComprobante` para mostrar el próximo número (guard de secuencia contra clicks rápidos).

### Guard fiscal `_verificarDatosFiscales()` (13302)
Bloquea emitir si falta `negocioCuit`/`negocioPuntoVenta`/`negocioCondicionIVA` (toast + link a Mi cuenta). También exige `afipAprobado===true` (o CUIT+PV presentes) — si no, "pendiente de aprobación por MB Strategy".

---

## Finanzas — Resumen de Ventas
**Vista:** `ct-resumen-ventas` (~3450) · `loadResumenVentas` (línea 16466) · tab `loadResumenVentas()` (31462)
**Lee:** `facturas` (`orderBy creadoEn desc limit(500)`), `notasCredito`, `notasDebito`. **Escribe:** nada. Es el **Libro IVA Ventas** del mes.

### Selector período `#rv-mes-select`
- `rvSelectMes(value)` (16584) → `_rvMesSel`, recarga. Opciones = meses del año en curso hasta el actual.

### KPIs (banner)
- `#rv-kpi-cant` cantidad de facturas (no NC/ND, excluye 'X') · `#rv-kpi-bruto` total bruto (facturas+ND) · `#rv-kpi-nc` cantidad NC · `#rv-kpi-nd` cantidad ND · `#rv-kpi-neto` neto general (`totGral`, con NC en negativo).

### Tabla `#rv-tabla` / `#rv-tbody` / `#rv-tfoot`
Une facturas+NC+ND del mes (normaliza NC/ND vía `normalizar()`), ordena por fecha. Columnas: Fecha · Tipo · N° · Receptor · Neto gravado · IVA 21% · IVA 10.5% · Total.
- NC (tipo 3,8,13) → signo −1, fondo rojizo. ND (2,7,12) → suma, fondo ámbar.
- Neto/IVA: si `netoGravado`+`iva` guardados los usa; si no, `neto=round(importeTotal/1.21)`, `iva21=total−neto`. IVA 10.5% siempre 0 (no se discrimina alícuota reducida).
- `#rv-tfoot` totales (neto, iva21, iva105, total general).
- Vacío (`facs.length===0`) → `#rv-empty`, oculta tabla y resumen IVA.

### Resumen IVA `#rv-iva-resumen` — solo RI
Se muestra sólo si `negocioCondicionIVA==='responsable_inscripto'`: tarjetas Neto gravado / IVA 21% / Total bruto.

### Exportar `#rv-dl-menu` (contenedor con `display:none` — botón oculto en el markup actual)
- `exportarResumenVentas()` (16588) → toast "en desarrollo" (no implementado).
- `exportarCitiVentas()` (16591) → genera `.txt` **CITI Ventas** (formato AFIP RG 3685, líneas de ancho fijo): lee `facturas` del mes, arma registro por comprobante (fecha, tipo CITI `{1:'001',...}`, PV, nro, doc receptor, importe*100, IVA). Sin escritura.

---

## Finanzas — Resumen de Compras
**Vista:** `ct-resumen-compras` (~3544) · `loadResumenCompras` (línea 16641) · tab `loadResumenCompras()` (31463)
**Lee:** `proveedores` (no `eliminado`) y para cada uno su subcolección `proveedores/{provId}/facturas`. **Escribe:** nada. Es el **Libro IVA Compras** del mes. NO usa la colección `facturas` (esa es de ventas); acá cada compra vive bajo su proveedor.

### Carga
- `getDocs(proveedores)` → filtra `!eliminado`.
- Por proveedor: `getDocs(proveedores/{id}/facturas)` en paralelo, anota `provId/provNombre/provCategoria`.
- `todas` = flat filtrado `!eliminado && esOC!==true` (excluye órdenes de compra).
- `resolverTipo(f)`: usa `f.tipoComprobante`; si no, 'X' si categoría "Retiro socio" / numero empieza "retiro" / desc "retiro de socio"; else 'C'. Filas con tipo 'X' se excluyen.

### Selector período `#rc-mes-select`
- `rcSelectMes(value)` (16732) → `_rcMesSel`, recarga. Filtra por `(f.fecha || f.creadoEn).slice(0,7)`.

### KPIs
- `#rc-kpi-cant` comprobantes · `#rc-kpi-total` total compras (`totGral`, `f.monto`) · `#rc-kpi-iva` crédito fiscal IVA (`totIva21+totIva105`) · `#rc-kpi-neto` neto gravado (solo Factura A).

### Tabla `#rc-tabla` / `#rc-tbody` / `#rc-tfoot`
Columnas: Fecha · Proveedor · Tipo · N° · Neto gravado · IVA 21% · IVA 10.5% · Total.
- Solo Factura A discrimina IVA: `neto = netoGravado guardado || round(monto/1.21)`; `iva21 = iva21 guardado || monto−neto`. No-A → neto/iva/celdas = '—', IVA 0.
- IVA 10.5% siempre 0. N° = `numeroComprobante || numero || '—'`.
- `#rc-tfoot` totales. Vacío → `#rc-empty` ("Cargá facturas en cuenta corriente de cada proveedor").

### Exportar `#rc-dl-menu` (oculto en markup)
- `exportarResumenCompras()` (16736) → toast "en desarrollo".
- `exportarCitiCompras()` (16739) → toast "en desarrollo" (CITI Compras no implementado, a diferencia de Ventas).

---

## Notas transversales
- **Fechas**: `creadoEn` en ventas es string ISO (se filtra `.slice(0,7)`); en compras se usa `fecha` (o `creadoEn`).
- **IVA**: la app asume alícuota única 21% (10.5% cableado en 0). Neto sólo se discrimina para RI (ventas) / Factura A (compras).
- **Anulación**: no hay borrado ni estado "anulada"; se anula/ajusta emitiendo NC (crédito) o ND (débito) imputada a la factura, con tope en el importe total.
- **Emisión** siempre server-side vía function `afip` (certificados ARCA en backend); el front sólo dispara y luego enriquece el doc con `items`/vínculo a presupuesto. `traducirErrorAFIP` (16231) mapea errores AFIP (10016 PV, 10070 IVA, 10051 importe, certificado/token, CUIT) a mensajes legibles.
- **CAE/QR**: el PDF (`_generarPdfComprobante`, 15725) arma el QR oficial ARCA (`arca.gob.ar/fe/qr/?p=<base64>`) con payload {cuit, ptoVta, tipoCmp, nroCmp, importe, codAut:cae}; banda "HOMOLOGACIÓN - SIN VALIDEZ FISCAL" si `ambiente==='homologacion'`.


---


# 05 · COMERCIAL (label visible) / "ventas" (interno) — Clientes + Cobranzas

Módulo interno `ventas`, label UI **Comercial**. Multi-tenant `clientes/{currentClientUID}/<subcol>`.
Roles con acceso (`_TAB_POR_ROL`, ~33377): `admin` (todo), `comercial` = `['mclientes','cobranzas','presupuestos','productos','catalogo']`, `vendedor` = idem + `caja`. `cajero` también entra a `mclientes`/`cobranzas` (whitelist en `showCTab` ~31394). Gate: `showCTab(tab)` → cajero por whitelist; resto por `tieneAccesoATab(tab)`. Ninguno de estos dos tabs tiene plan-gate.

---

## Comercial — Clientes
**Vista:** `ct-mclientes` (~4140) · loader `loadMcModule()` (~22123) · render `renderMcModule()` (~22369) · roles: admin/comercial/vendedor/cajero
**Lee:** `clientes/{id}/misClientes` (filtra `!eliminado` → `_mcClientes`, ordena por `nombre`) + `clientes/{id}/presupuestos` (filtra `!eliminado` → `_mcPresupuestos`, ordena por `creadoEn` desc). Cachés globales `window._mcClientes` / `window._mcPresupuestos`.
**Campos `misClientes` leídos:** `nombre, apellido, dni, cuit, condicionIVA, direccion, ciudad, tel(o telefono), email, notas, estado, totalCobrado, totalCaja, ultimoContacto, creadoEn, eliminado`.
**Sub-vistas del tab:** `mc-lista-view` (default) y `mc-detalle-view` (detalle cliente). Además existe toggle lista/kanban (`setMcView`), pero el HTML activo usa la grilla de tarjetas de `renderMcLista`.

### Banner + KPIs (`mc-kpi-*`, renderMcModule ~22369)
- `mc-kpi-total` → `_mcClientes.length` · lee cache
- `mc-kpi-cobrado` → suma `totalCobrado` de todos los clientes · lee `misClientes.totalCobrado`
- `mc-kpi-pendiente` → `max(0, ΣpresupAprobados − Σcobrado)` · `presupuestos.estado==='Aprobado'` vía `getPresupMonto(p)`
- (mismos valores duplicados en `bn-mc-activos/cobrado/pendiente`)

### Barra acciones (header banner ~4153)
- `botón +` (`#b09088`) → `abrirNuevoMcClienteModal()` · abre modal alta
- `botón ↓` exportar → `toggleDropdown('mc-dl-menu')` → `abrirReporteClientes()` (Reporte Cuentas/Directorio)
- `input #mc-search` → `filterMcLista()` · filtra en memoria por `nombre` (no lee/escribe DB)

### Lista de clientes (tarjetas) — `renderMcLista(clientes)` (~22490)
Grilla 3 col. Si `_mcClientes` vacío → empty-state onboarding (3 pasos) con botón `+ Cargar mi primer cliente`→`abrirNuevoMcClienteModal()`.
Por tarjeta (lee cliente + presupuestos):
- Iniciales de `nombre`; subtítulo = `tel|dni` · `ciudad`
- **saldo** = `Σpresup(estado Aprobado|Cobrado)·getPresupMonto` + `totalCaja` − `totalCobrado`
  - badge: saldo>0 "Con saldo pendiente", saldo<0 "Saldo a favor", 0 "Al día"; monto `$abs(saldo)`
- click tarjeta → `openMcDetalle(id)`
- `botón editar` → `editMcCliente(id,event)`
- `botón eliminar` → `deleteMcCliente(id,event)`

### Kanban (`renderMcKanban` ~22587)
Columnas por `estado`: `Potencial→mc-col-prospecto, Activo→mc-col-activo, En pausa→mc-col-pausa, Cerrado→mc-col-cerrado` (default Potencial). Tarjeta muestra `nombre`, `totalCobrado` si >0, N° presup (`_mcPresupuestos` por `clienteId` o `cliente===nombre`). Click → `openMcDetalle`. Solo lee.

### Modal alta/edición cliente — `newMclienteModal` (~5852)
Header dice "Cajero · Clientes" (label estático). Campos: `mcc-nombre, mcc-apellido, mcc-tel, mcc-email, mcc-dni, mcc-cuit`, pills `condicionIVA` (hidden `mcc-condicion-iva`; valores `5`=Cons. Final default, `6`=Monotributo, `1`=Resp. Insc., `4`=Exento), `mcc-direccion, mcc-ciudad, mcc-notas`. Botón `mcc-save-btn`.
- **Alta** `createMcCliente()` (~23455): valida `nombre` requerido; valida DNI/CUIT duplicado contra `_mcClientes` (normaliza `\D`). **Escribe** `addDoc misClientes` con `{nombre(=nombre+' '+apellido si hay), apellido, dni, cuit, condicionIVA, direccion, ciudad, tel, email, notas, ultimoContacto, creadoEn}`. Luego `loadMcModule()`.
- **Edición** `editMcCliente(id)` (~23509) precarga campos (recorta apellido del nombre); setea botón→`saveMcCliente(id)`, título "Editar cliente".
  - `saveMcCliente(id)` (~23535): misma validación dup (excluye `id` propio). **Escribe** `updateDoc misClientes/{id}` con los mismos campos (no toca `totalCobrado/totalCaja/creadoEn`). Reabre detalle si estaba abierto.
- **Eliminar** `deleteMcCliente(id)` (~23579): `showConfirm` → **soft-delete** `updateDoc misClientes/{id} {eliminado:true, eliminadoEn}`; recarga + `closeMcDetalle()`. (No borra físicamente subcolecciones.)

### Detalle cliente — `openMcDetalle(id)` (~22613) [async, lee varias subcol]
Muestra `mc-detalle-view`. Header avatar/nombre/meta (`tel/dni/direccion`). Alerta seguimiento: si `ultimoContacto` ≥7d → "⚠ Nd sin contacto" (≥14d rojo).
**KPIs CC (recalcula en vivo, con auto-sync a DB):**
- `mcd-total` = `Σpresup(Aprobado|Cobrado)·getPresupMonto` + **`totalCaja`**
  - `totalCaja` recalculado leyendo `clientes/{id}/libroCaja where clienteId==id`, sumando movs `(tipo==='ingreso' && origen==='venta_caja') || tipo==='pedido_cta'`. Si difiere de `misClientes.totalCaja` → **escribe** `updateDoc {totalCaja}`.
- `mcd-cobrado` = Σ `misClientes/{id}/cobros` (`!eliminado`) `monto`. Si difiere de `totalCobrado` → **escribe** `updateDoc {totalCobrado}` (sincroniza).
- `mcd-pendiente` = `(total+totalCaja) − cobradoReal`; si <0 "Saldo a favor" (verde), si ≥0 rosa.
Bloques del detalle (3 filas × 2):
- **DATOS**: filas tel/email/dni/cuit/direccion (solo si presentes)
- **VENTAS · PEDIDOS DE CAJA** `renderMcVentas` (~23591): presup `Aprobado|Cobrado` + `libroCaja tipo==='pedido_cta'`; badge Pendiente/Cobrado (`monto−cobradoPorPresup`); pedido caja click→`cajaMovDetalle`
- **ACTIVIDAD** `renderMcHistorial(id)` (~22772): lee `misClientes/{id}/historial` (`!eliminado`), ordena por `fecha` desc, top 10. Dot color según texto (cobro/presupuesto aprobado). Escritura vía `addHistorialEntry(clienteId,texto)` (~22765) → `addDoc historial {texto,fecha}`
- **PRESUPUESTOS** `renderMcDetallePresupuestos` + botón `+ Nuevo`→`openMcPresupModal(id,nombre)`
- **NOTAS** `renderMcDetalleNotas(id)` (~23233): lee `misClientes/{id}/notas` (`!eliminado`), top 5. Guardar `guardarNotaMcCliente(id)` (~23251): **escribe** `addDoc notas {texto,fecha}` + `updateDoc misClientes {ultimoContacto}` + `addHistorialEntry('Nota interna agregada')`
- **COBROS RECIBIDOS** `loadMcCobrosList(id)` (~22980): lee `misClientes/{id}/cobros`, ordena por `creadoEn/fecha` desc, muestra `concepto/fecha/formaPago/monto`. Botón `+ Cobro` (`mcd-quick-cobro`)→`abrirModalCobroLibre(id,nombre)`
- Header acciones detalle: `Reporte`→`abrirReporteCli(id)`, editar→`editMcCliente`, eliminar→`deleteMcCliente`
- `eliminarCobro(clienteId,cobroId,monto)` (~23011): soft-delete cobro + resta `totalCobrado` (`max(0,…)`)

### Cobro libre desde CC (`+ Cobro` del detalle) — `modal-cobro-libre`
- `abrirModalCobroLibre(clienteId,nombre)` (~23032): selector `mcl-presup-sel` = presups `Aprobado` con saldo (`getPresupMonto−cobradoPorPresup>0`) + opción "Cuenta general (sin presupuesto)"; preselecciona si hay 1 solo. `forma` default Transferencia.
- `guardarCobroLibre()` (~23068): **escribe**:
  1. `addDoc misClientes/{id}/cobros {concepto,formaPago,monto,moneda:'ARS',fecha,presupId|null,creadoEn}`
  2. `updateDoc misClientes/{id} {totalCobrado+=monto, ultimoContacto}`
  3. Si `presupId`: `updateDoc presupuestos/{presupId} {cobradoPorPresup+=monto}`, y si `≥getPresupMonto` → `estado:'Cobrado'`
  4. `addDoc ingresos {concepto,categoria:'Cobro de cliente',monto,fecha,mes,origen:'comercial',clienteId,cliente}`
  (No escribe libroCaja — a diferencia del cobro de Cobranzas.)

---

## Comercial — Cobranzas
**Vista:** `ct-cobranzas` (~4294) · loader `loadCobranzasModule()` (~22147) · roles: admin/comercial/vendedor/cajero
Subtítulo: "Presupuestos aprobados pendientes de cobro". Dos tabs (`cbVista`): **Pendientes** (default) / **Cobradas**. Filtro período (solo Pendientes): `cbFiltrarPeriodo('todos'|'semana'|'mes'|'vencidos')` — semana ≤7d, mes ≤30d, +30 días >30d. Estado en `window._cbVista` / `window._cbPeriodo`.

**Lee:** `misClientes` (mapa por id y por nombre) + `presupuestos` + `cobros where estado=='pendiente'` (Promise.all).

### Tab Pendientes (`loadCobranzasModule`)
Combina dos fuentes en la tabla `cb-tabla`/`cb-tbody`:
1. **`cobros` (estado 'pendiente')** — típicamente del cajero (pedido a cuenta). Campos leídos: `clienteId, clienteNombre, monto, ticketNum, concepto, creadoEn, libroCajaId`. `dias`= días desde `creadoEn`.
2. **`presupuestos` estado 'Aprobado'** con neteo: `monto = getPresupMonto(p) − cobradoPorPresup`; si `≤0` se omite (los saldados van a "Cobradas"). Vincula cliente por `clienteId` o `cliente===nombre` para sacar `tel`.
- KPIs: `cb-kpi-total` = Σ monto ARS pendiente; `cb-kpi-cantidad` = N ítems. Label del KPI = "Total pendiente".
- Orden por `fecha` desc. Empty-state onboarding si 0 pendientes; mensaje aparte si el período filtra todo.
- **Badge días** (color): >30d rojo, ≥7d ámbar, <7 verde.
- **Buscador** `cb-search-input`→`cbSearch()` (filtra filas por `cliente|tel|descripcion|ticketNum`, in-memory).
Por fila:
- click fila (desktop, si hay `clienteId`) → `openMcDetalle(clienteId)`
- **botón Cobrar** → `openMcCobroModal(clienteId, id, descripcion, monto, libroCajaId)`
- **botón WhatsApp** (si hay `tel`): `https://wa.me/549{tel}?text=...` mensaje pre-armado con `nombre negocio`, monto y descripción (recordatorio de pago). Solo abre link, no escribe DB.
- Mobile: tarjeta con botón Cobrar + WA.

### Tab Cobradas (`_cbRenderCobradas` ~22311)
Lee `presupuestos` `estado==='Cobrado'` (`!eliminado`). Reusa la tabla; badge verde "Saldado". KPI total = Σ `getPresupMonto`, label "Total cobrado". Sin acciones (histórico, "nada muere en silencio").

### Modal registrar cobro — `newMcCobroModal` (~5913), `openMcCobroModal` (~22797)
Campos: hidden `mcc-cobro-cliente-id/presup-id/libroCaja-id/monto/cuenta/moneda(ARS)/concepto/fecha`; display monto/subtítulo/fecha; **Medio de pago** pills `mccSelMedio` (Efectivo/Transferencia/Mercado Pago/Tarjeta → hidden `mcc-cobro-forma`). Para Efectivo la `cuenta` = `window._cajaActivaNombre || 'Caja mostrador'`; otros medios cuenta=medio. Observación `mcc-cobro-notas`.
- **`createMcCobro()`** (~22843) — **escribe (cadena completa):**
  1. `addDoc misClientes/{clienteId}/cobros {concepto,formaPago,monto,moneda,fecha,notas,creadoEn}`
  2. `updateDoc misClientes/{clienteId} {totalCobrado += monto, ultimoContacto}`
  3b. Si `presupId`: `updateDoc presupuestos/{presupId} {cobradoPorPresup += monto}`, y si `≥getPresupMonto` → `estado:'Cobrado'` (guard: solo si presup existe y monto>0)
  3c. Si `presupId` corresponde a doc de `cobros` (cajero): `updateDoc cobros/{presupId} {estado:'pagado'}` (ignora si no existe). Si `libroCajaId`: `updateDoc libroCaja/{id} {estado:'cobrado'}`
  4. `addDoc ingresos {concepto,categoria:'Cobro de cliente',monto,fecha,mes,origen:'comercial',clienteId,cliente}`
  4b. `addDoc libroCaja {uid,fecha,tipo:'ingreso',concepto:'Cobro · '+nombre,cuenta,medioPago,monto,origen:'cobro_cliente',turnoId(si rol cajero y turno activo),clienteId,clienteNombre,referenciaId(presupId si hay),detalle,mes,eliminado:false,creadoEn,creadoPor}`
  5. `loadClientContabilidad()`; 6. `addHistorialEntry(cobro registrado)`. Al cerrar recarga `loadMcCobrosList` + `loadMcModule` + `loadCobranzasModule`.
  Nota doctrina: reusa `presupId` como identificador tanto para presupuesto como para doc de `cobros` (mismo campo hidden); ingreso a contabilidad + libroCaja siempre.

---

### Dos libros / relación (contexto memoria)
- **CC del cliente** (`misClientes.totalCobrado`, subcol `cobros`) y **presupuesto** (`presupuestos.cobradoPorPresup`) son libros separados; se unen por `presupId`.
- Cobranzas **netea** (`getPresupMonto − cobradoPorPresup`) y muestra saldados en tab **Cobradas**.
- `getPresupMonto(p)` = helper de monto del presupuesto (usado en todos los cálculos).
- Auto-sync defensivo en `openMcDetalle`: recalcula `totalCaja` (desde `libroCaja`) y `totalCobrado` (desde subcol `cobros`) y reescribe si están desincronizados.


---


# 06 — Comercial: Presupuestos y Catálogo de precios

> App cliente (SPA multi-tenant `clientes/{clienteId}/...`). Sección **Comercial** del subnav. No hay gating explícito por rol dentro de estas funciones (solo chequean `currentClientUID`); el acceso se controla por el subnav Comercial y por plan. `openModal('miCuentaModal')` sí exige `currentRol==='admin'` pero eso no afecta estos módulos.

## Comercial — Presupuestos
**Vista:** `id="ct-presupuestos"` (~4080) · `loadClientPresupuestos` (24087) · `renderClientPresup` (24118) · roles: admin/comercial/vendedor (sin gate en código)
**Colección:** `clientes/{id}/presupuestos`
**Campos leídos:** `eliminado`, `creadoEn`, `estado`, `cobradoPorPresup`, `items[]` (`{desc,cant,precio,productoId}`), `monto`, `moneda`, `cliente`, `clienteId`, `prospecto`, `descripcion`, `numero`, `fecha`, `validez`, `notas`, `adjunto`, `link`
**Campos escritos:** `cliente`, `clienteId`, `prospecto`, `numero`, `descripcion`, `items`, `monto`, `moneda`, `estado`, `fecha`, `validez`, `notas`, `creadoEn`, `adjunto`, `cobradoPorPresup`, `eliminado`/`eliminadoEn`
**Caches:** `window._clientPresupuestos`, `window._mcPresupuestos`, `_mcPresupuestos` (mismo array). `getPresupMonto(p)` (24220) = suma `items` (cant×precio) o fallback `p.monto`.

### Listado y KPIs (banner + filtros)
- `loadClientPresupuestos` → `getDocs(presupuestos)`, filtra `!eliminado`, ordena por `creadoEn` desc · setea contadores por estado y KPIs banner.
- KPI `bn-pre-monto` → Σ `getPresupMonto` de todos · `bn-pre-porcobrar` → Σ `max(0, getPresupMonto - cobradoPorPresup)` sobre `estado==='Aprobado'` · `bn-pre-aprob` / `bn-pre-cobrados` → counts.
- Contadores filtro: `cp-tot`, `cp-penv` (Pendiente de enviar), `cp-env` (Enviado), `cp-apr` (Aprobado), `cp-cob` (Cobrado).
- `filterClientPresup(estado,btn)` (24211) → filtra `_clientPresupuestos` por `estado` (o 'todos') y re-renderiza · pills `.presup-fil`.
- Botón `+` (header) → `openModal('newClientPresupModal')` · Botón exportar → `toggleDropdown('pre-dl-menu')` → `abrirReportePresup()`.
- Render fila (desktop grid / mobile card): franja color + badge estado por `dot`/`badge` map · muestra `cliente` (o "Sin cliente"), badge "Prospecto" si `prospecto && !clienteId`, `descripcion`, `fecha`, alerta "⚠ seguimiento" si `Enviado` y ≥7 días desde `fecha`, monto+`moneda`.

### Estados y transiciones
- Estados: `Pendiente de enviar` · `Enviado` · `Consultado` · `Aprobado` · `Denegado` · `Cobrado`.
- Badge de estado es un dropdown (salvo si `Cobrado`, que queda fijo) → `updateClientPresupEstado(id, nuevoEstado)` (23713).
  - Escribe `{estado}`; si `estado!=='Cobrado'` además `cobradoPorPresup: 0` (evita auto-Cobrado espurio).
  - Si nuevo estado `Aprobado`/`Denegado` y `p.clienteId` → `addHistorialEntry` en el cliente.
  - Recarga `loadClientPresupuestos` + `loadMcModule`.
  - Si `Aprobado` y **sin** `clienteId` (prospecto) → abre `convertirProspectoModal` (precarga `conv-presup-id`, `conv-nombre`) · si hay `_currentMcClienteId` reabre detalle.
- `updateMcPresupEstado` (23741) → variante gemela invocada desde el detalle del cliente (mismo comportamiento; escribe igual).
- `confirmarConversionCliente` (25093) → crea doc en `misClientes` (nombre, dni, cuit, tel, email, condicionIVA, direccion, totalCobrado:0, ...) y vincula el presup: escribe `{clienteId, cliente:nombre, prospecto:false}` + historial "Cliente creado desde presupuesto aprobado".

### Acciones por presupuesto (fila)
- `exportarPresupuestoPDF(id)` (24022) → arma preview vía `_presupBuildDoc` y abre `presupPreviewModal` (ícono ojo "Ver").
- `descargarPresupuestoPDF(id)` (24035) → genera PDF offscreen vía `_presupBuildDoc` + `_presupExportUnificado` (incluye adjunto/link).
- `imprimirPresupuesto()` (24050) / `verPresupuestoPDF(id)` (24067, abre `p.link` en ventana) — helpers de preview.
- `editClientPresup(id)` (11130) → abre `editPresromModal` (`editPresupModal`); solo visible si `estado!=='Cobrado'`. Precarga `ep-*` (cliente, desc, monto, moneda, estado, fecha, notas, adjunto). **Nota:** el editor trabaja con `monto`/`moneda` planos (no re-edita `items`).
  - `saveEditPresup()` (11172) → `updateDoc(presupuestos/{id}, {cliente,descripcion,link,adjunto,monto,moneda,estado,fecha,notas})`; historial si cambió a Aprobado/Denegado; recarga presups + mc.
- `deleteClientPresup(id)` (24080) → `showConfirm` → soft-delete `{eliminado:true, eliminadoEn}`.
- `goToClientFromPresup(clienteId)` (24074) → navega a `mclientes` y `openMcDetalle`.
- `abrirFacturaDesdePresupuesto(presupId)` (23767) → va a Finanzas › Mis facturas, precarga factura libre con item `{desc, cantidad:1, precio:getPresupMonto}` y CUIT del cliente si existe.
- **Cobro:** no hay botón "cobrar" en la fila del listado de presupuestos. El cobro se hace desde el detalle del cliente (`newMcCobroModal` → `createMcCobro`, usa `mcc-cobro-presup-id`); ahí se actualiza `cobradoPorPresup` (leído aquí para "Por cobrar"). Si `cobradoPorPresup >= monto` el presup pasa a `Cobrado`.

### Modal nuevo presupuesto — `newClientPresupModal` (5792)
Apertura `openModal('newClientPresupModal')` (lógica en 33802): resetea búsqueda, setea `cp-fecha`=hoy, `cp-validez`=hoy+30d, `cp-numero`=`formatPresupNumero(nº)`, limpia campos, `_cpItems=[]`, resetea adjunto, y **puebla `cp-item-prod`** desde `_productosData` (solo `activo!==false`) + opción `＋ Agregar nuevo producto`.
- `formatPresupNumero(n)` (23320) → `'0001-' + n.padStart(8,'0')`; n = `_mcPresupuestos.length + 1`.
- `cp-cliente-search` → autocomplete · `cpFiltrarClientes(q)` (25017) filtra `_mcClientes` por nombre (máx 8) + opción "Usar '<q>' como prospecto".
  - `cpSeleccionarCliente(id,nombre)` → setea `cp-cliente-search`+`cp-cliente-id` (hidden) · `cpSeleccionarProspecto(nombre)` → deja `cp-cliente-id` vacío (prospecto). Navegación por teclado: `cpClienteKeydown` (25049).
- `cp-numero` (readonly, auto) · `cp-fecha` · `cp-desc` (descripción del trabajo).
- **Ítems** (`cp-items-list`, cache `_cpItems` / `window._cpItems`):
  - `cp-item-prod` (select catálogo) → `onCpItemProdSelect()` (30958): si valor `__nuevo__` muestra mini-form `cp-nuevo-prod-wrap`; si producto, autocompleta `cp-item-desc` (nombre) y `cp-item-precio` (data-precio).
  - `cp-item-cant` (default 1) · `cp-item-precio` · `cp-item-desc` (opcional).
  - `addCpItem()` (24975) → valida precio>0, push `{desc,cant,precio,productoId}` a `_cpItems` → `renderCpItems()`.
  - `renderCpItems()` (24944) → tabla con cant editable inline (`updateCpItemCant` 24998), `removeCpItem(i)` (24992), total en `cp-total-display`.
  - Mini-form nuevo producto inline: `guardarNuevoProdCp()` (33978) → `_agregarNuevoProdInline` (33935) crea doc en `clientes/{id}/productos` `{nombre,precio,activo:true,creadoEn,updatedAt}`, lo agrega a `_productosData` y al select. `cancelarNuevoProdCp()` (33981) cierra.
- `cp-moneda` (ARS/USD) · `cp-total-display` (Σ items) · `cp-validez` · `cp-estado` (select 6 estados) · `cp-notas` · `cp-adjunto-zone` (adjunto opcional, `_presupAdjPersist`).
- Guardar: `createClientPresup()` (25136) → valida nombre cliente + ≥1 ítem · calcula `total` · sube adjunto (`_presupAdjPersist`) · `setDoc(presupuestos/{newId}, data)` donde `data={cliente,clienteId|null,prospecto:!clienteId,numero,descripcion,items:[...],monto:total,moneda,estado,fecha,validez,notas,creadoEn,adjunto?}` · si `clienteId` → historial · recarga presups+mc · abre preview PDF del recién guardado.

### Reporte / Export
- `abrirReportePresup()` (24897) → `_presLoadRaw`+`_presRerender`, abre `reportePresupModal`.
- `_presPDF()` (24905) → PDF vía `_pdfCaptureDoc` · `_presExcel()` (24916) → Excel (ExcelJS CDN) cols Número/Cliente/Fecha/Estado/Monto, filtrable por estado y búsqueda.

---

## Comercial — Catálogo de precios (productos)
**Vista:** `id="ct-productos"` (~4537) · `loadProductos` (25197, versión "module") · `renderProductosModule` (25217)
**Colección:** `clientes/{id}/productos`
**Campos leídos:** `eliminado`, `nombre`, `precio`, `descripcion`, `activo`, `manejaStock`, `updatedAt`, `stockActual`
**Campos escritos:** `nombre`, `precio`, `descripcion`, `activo`, `manejaStock`, `updatedAt`, `creadoEn`, `stockActual`, `stockMinimo`, `costoUnitario`, `eliminado`/`eliminadoEn`
**Caches:** `_productos` / `window._productos` / `window._productosData`.

> ⚠️ **No existe** colección `clientes/{id}/listas` ni "listas de precios múltiples", ni campo `categoria` en productos (las categorías son solo del módulo Compras). El catálogo es un único precio por producto; la columna "Nuevo precio" es edición masiva de precios (no listas). No hay importación de productos.

> ⚠️ **Dos definiciones de `loadProductos`** en el archivo: la "module" (25197, usa `renderProductosModule`, cruza `_cajaMovimientos` en memoria) y una "plain" (34073, re-importa firebase-firestore y renderiza inline, lee `libroCaja` directo). La segunda declaración (34073) es la que prevalece en runtime para `loadProductos`; ambas leen la misma colección y pintan `prod-lista`. `editProducto`/`deleteProducto` usan `window._productosData` (seteado por ambas).

### Listado + KPIs (banner sage)
- `renderProductosModule` / plain → ordena por `nombre`, filtra `!eliminado`.
- KPIs: `prod-kpi-activos` = count `activo!==false` (+ sub "de N en el catálogo") · `prod-kpi-rentable` = ítem con más ingresos (cruza `libroCaja`: `origen==='venta_caja'` productos[], o `tipo==='ingreso'` por `concepto===nombre`) · `prod-kpi-meses` = meses desde el `updatedAt` más reciente.
- Fila (grid `1fr 120px 110px 50px 50px 60px`): `nombre` (tachado si inactivo) + `descripcion` · **Precio actual** (`$precio`) · **Nuevo precio** (input editable `.prod-precio-input`, `oninput→mvmFormatMonto+marcarCambioPrecio`) · toggle **Stock** (`manejaStock`) · toggle **Activo** · botones editar/eliminar.
- Empty state → `abrirNuevoProducto()`.

### Acciones
- Botón `+` header → `abrirNuevoProducto()` (34214) → limpia `prod-*`, título "Nuevo producto", abre `newProductoModal`.
- **Modal `newProductoModal`** (6102): campos `prod-edit-id` (hidden), `prod-nombre`, `prod-precio` (`mvmFormatMonto`), `prod-desc`. Botón `prod-modal-btn` → `createProducto()`.
  - `createProducto()` (34170) → valida nombre · `data={nombre, precio (parse es-AR), descripcion, activo:true, updatedAt}`.
    - Si `prod-edit-id` → `updateDoc(productos/{id}, data)` (no toca `creadoEn` ni stock).
    - Si nuevo → agrega `creadoEn`, `stockActual:0`, `stockMinimo:null`, `costoUnitario:0`, `manejaStock:false` → `addDoc`.
    - Recarga `loadProductos`, cierra modal.
- `editProducto(id)` (34226) → precarga desde `_productosData`, título "Editar producto", abre modal (guarda con `createProducto`).
- `deleteProducto(id)` (34241) → `showConfirm` → soft-delete `{eliminado:true, eliminadoEn}`.
- `toggleActivoProducto(id, nuevo)` (34254) → `updateDoc {activo, updatedAt}`.
- `toggleManejaStock(id, nuevo)` (34265) → `updateDoc {manejaStock, updatedAt}` (vincula con módulo Stock).
- **Guardar precios (masivo):** `marcarCambioPrecio()` (34298) muestra footer `prod-footer-guardar` al editar cualquier "Nuevo precio" · `guardarPrecios()` (34276) → recorre `.prod-precio-input`, para cada `precio` cambiado → `updateDoc(productos/{pid}, {precio, updatedAt})` · recarga.

### Consumo del catálogo por Presupuestos
- `loadProductos` (plain) actualiza los selects `cp-item-prod` y `mcp-item-prod` con productos `activo!==false` (`data-precio`, `data-nombre`) + opción `＋ Agregar nuevo producto`.
- `actualizarSelectorProductos()` (25344) actualiza `cli-ing-producto` (ventas/ingresos).


---


# Módulo COMPRAS — `index.html`

**Acceso módulo:** topbar `showClientMod('compras')` (L31306) → `showSubnav('subnav-compras')` + `showCTab('proveedores')`. Sidebar `sidebarNav('compras',<sub>)` (L1761-1771).
**Roles:** `admin` (`_TAB_POR_ROL.admin=null` → todo) y `compras` = `['proveedores','necesidades','ordenes-compra','historial-compra','prod-compra','categorias-compra']` (L33380). Gate en `showCTab`: `tieneAccesoATab(tab)` (L31396/33441); `cajero` bloqueado (whitelist caja). Sin gating por plan en Compras (los `_planGate` L31417 son solo stock/producción/auditoría).
**Carga inicial** (L8034-8036): `loadProductosCompra()`, `loadNecesidades()`, `loadOrdenesCompra()` precargan en background.
**Estado en memoria:** `_proveedores`, `_ordenesCompra`, `_prodCompra`, `_necesidades`, `_catsProv` (+ espejos `window.*`). CC: `_ccProvId,_ccFacturas,_ccPagos,_ccOCsComoFactura` (L28088).
**Helper montos OC:** `window._ocMontoReal(o)` (L27187) = `totalRecibido` si recibida/parcial y no-null, si no `total`.

---

## Compras — Proveedores (listado)
**Vista:** `ct-proveedores` (L4583) · sub `prov-lista-view` (L4585) · `loadProveedores` (L30244) → `renderProveedoresModule` (L30277) + `renderListaProveedores` (L30358) · roles: admin/compras
**Lee:** `clientes/{id}/proveedores` (campos `nombre,cuit,condicionIVA,categoria,tel,costoFijo,notas,creadoEn,eliminado`), `clientes/{id}/ordenesCompra`, subcolecciones `proveedores/{pid}/facturas` y `/pagos` (para saldo). También `window._clientEgresos` (gasto real por `proveedorId`).
**Escribe:** `proveedores` (add/update/soft-delete).
**Carga saldos** (L30259): por proveedor suma `facturas.monto` − `pagos.monto` (ignora `eliminado`) → `p._saldo`, `p._saldoFavor`, `p._totalFac`.

### Header KPIs (L4604)
- `prov-kpi-total` = `_proveedores.length`
- `prov-kpi-gastado` = Σ gasto por proveedor (egresos con `proveedorId` + OC via `_ocMontoReal`) (L30291-30305)
- `prov-kpi-pendiente-cc` = Σ `p._saldo` (deuda CC)

### Lista (`prov-lista`, L4639/30421)
- Card por proveedor: avatar iniciales, `nombre`, `categoria`+`tel`, badge saldo (`Con deuda`/`Al día` si `_totalFac>0`/`Sin actividad`), `notas`.
- `CC` → `abrirCuentaCorriente(p.id)` · `editar` → `editProveedor` · `eliminar` → `deleteProveedor`
- `filtrarProveedores(q)` (L30450) filtra por nombre/categoría.
- Estado vacío: onboarding 3 pasos + `+ Agregar primer proveedor` → `openModal('newProveedorModal')`.

### Side cards (L4644)
- `prov-ranking` (mayor gasto, desde egresos+OC) · `prov-deuda-ranking` (mayor deuda, `_saldo>0`, click → `abrirCuentaCorriente`)

### Modal Nuevo/Editar proveedor (`newProveedorModal`)
Abrir botón `+` (L4591) → `openModal` (L33898: resetea cat, título 'Nuevo proveedor').
- `nprov-nombre` (req) · `mprov-cuit` · `mprov-condicion-iva` (pills, default `'5'`) · `nprov-cat` (select via `renderCatSelect`) · `nprov-tel` · `nprov-costo-fijo` · `nprov-notas`
- `createProveedor` (L30474) → `addDoc proveedores` {nombre,cuit,condicionIVA,categoria,tel,costoFijo,notas,creadoEn} · luego `loadProveedores`
- `editProveedor(id)` (L30486) precarga campos, botón pasa a `saveProveedor(id)`; `saveProveedor` (L30503) → `updateDoc` (sin creadoEn)
- `deleteProveedor(id)` (L30514) → soft-delete `{eliminado:true,eliminadoEn}`; si tiene OC activas avisa antes (`showConfirm`).
- **`condicionIVA`** determina tipo de comprobante en CC (`_inferTipoComprobante` L29177): `'1'`→A/B según IVA del negocio, `'6'`/`'4'`→C, categoría `Retiro socio`→X, resto→X.

### Export (L4595)
- `prov-dl-menu` → `abrirReporteProv()` (Reporte PDF/Excel)

---

## Compras — Cuenta Corriente (CC proveedor)
**Vista:** `prov-cc-view` (fullscreen dentro de `ct-proveedores`, L4659) · `abrirCuentaCorriente(provId)` (L28090) → `renderCuentaCorriente` (L28661) · roles: admin/compras
**Lee:** `proveedores/{pid}/facturas` (`monto,fecha,numero,tipoComprobante,numeroComprobante,items,ocId,desc,esOC,estado,montoPagado,netoGravado,iva21,total,creadoEn,eliminado`), `proveedores/{pid}/pagos` (`tipo,numero(OP),monto,montoLibre,fecha,medio,concepto,facturasIds,facturasNombres,facturasMontos,creadoEn`), `ordenesCompra` (OC del prov).
**Estructura movimientos** (L28723): `_ccFacturas`=facturas reales (`esOC!=true`), `_ccOCsComoFactura`=facturas auto de OC (`esOC===true`), OC recibidas sin factura como ítem, pagos anidados bajo su factura/OC (via `facturasIds`/`facturaId`), pagos sin imputar al final.
**Cálculo saldo** (L28668-28680): `totalComprado` = (facturas + OCsComoFactura) o fallback `totalDeOCs` (OC recibidas/parciales, `totalRecibido||total`). `saldoPendiente = max(0, comprado−pagado)`, `saldoFavor` inverso. Actualiza `prov._saldo`.
**Apertura** (L28090): oculta hijos de `ct-proveedores`, muestra `prov-cc-view`, oculta `subnav-compras`; header sincrónico + KPIs (`cc-kpi-comprado/pagado/pendiente/ocs-full`); carga OC del prov (`cc-ocs-lista-full`, click → `abrirDetalleOC`) y facturas/pagos → `renderCuentaCorriente`.
**Cerrar:** `cerrarCCView()` (L28175) restaura lista + subnav.

### Movimientos (`cc-movimientos-full`)
- Cada ítem factura/OC clickeable → `verDetalleMovCC(tipo,mov)`; pagos con botón `PDF` → `verPDFop(id)`.
- Badges factura: `pendiente/pagada/parcial` (por `estado`). OC sin factura: `Pend. factura`; con pago: `Pagada`/`Pago parcial`.

### Botón `+ Factura` → modal `newFacturaModal` · `saveFactura` (L29212)
Tipo inferido por `condicionIVA` del prov (`_inferTipoComprobante`). Fiscal (A/B/C) exige CUIT + prefijo(4)+nro(8) → `numeroComprobante`. No-fiscal (X) usa `fac-numero` libre.
- Campos: `fac-fecha`, `fac-monto` (o ítems `_facItems`→ `fac-*` renglones), `fac-prefijo`/`fac-nrocomp` o `fac-numero`, `fac-desc`, `fac-oc` (asociar OC).
- Ítems (`_facItems`, L29220): `{insumoId,prodCompraId,productoId,nombre,cantidad,precioUnit,subtotal}`. Tipo A calcula `netoGravado/iva21/total`.
- **Escribe** `proveedores/{pid}/facturas` {numero,monto,fecha,tipoComprobante,numeroComprobante,items,ocId,desc,esOC:false,estado:'pendiente',creadoEn,[netoGravado,iva21,total,ocAjustada]}.
- Si `ocId` y ya existe factura `esOC:true` de esa OC → la **actualiza** (esOC:true→false), no duplica (L29263-29301).
- Si `_facAjustarOC` → `_facEjecutarCruceOC(oc,items,nro)` (ajusta OC/stock, L29303).
- Cierra + `abrirCuentaCorriente(_ccProvId)`.

### Botón `+ Registrar pago` → modal `newPagoProvModal` · `savePagoProveedor` (L29420)
Prep `openModal_newPagoProvModal_extra` (L29327): número OP correlativo `OP-####` (`pagos.size+1`), carga cuentas activas (`clientes/{id}/cuentas`), lista facturas pendientes (`_ccFacturas`+`_ccOCsComoFactura` con `estado!='pagada'` y pendiente>0), checkboxes → `recalcularTotalOP`.
- Campos: `npp-fecha`, `npp-medio`, `npp-cuenta`, `npp-concepto`, `npp-monto-libre`, checkboxes facturas.
- **Escribe** (por cada factura marcada): `updateDoc facturas/{fid}` {estado:`pagada`|`parcial`, montoPagado}; si `esOC` propaga `estadoPago` a `ordenesCompra/{ocId}`.
- **Escribe** `proveedores/{pid}/pagos` (OP) {tipo:'pago',numero,monto,montoLibre,fecha,medio,concepto,facturasIds,facturasNombres,facturasMontos,creadoEn}.
- **Escribe** `clientes/{id}/egresos` {concepto:`Pago a <prov> — OP-#`,proveedorNombre,proveedorId,monto,fecha,categoria:'Proveedores',medio,opId,eliminado:false} (L29486).
- **Escribe** `clientes/{id}/libroCaja` {tipo:'egreso',concepto:'Proveedor',cuenta,monto,origen:'proveedor',referenciaId:opId,proveedorNombre,proveedorId,detalle,mes,creadoPor} (L29501).
- Refresca CC + `loadContabilidad`. Guard `_savingPago` anti doble-submit.

### Botón `↓ Reporte` → `abrirReporteCC()` (L4707)

---

## Compras — Necesidades
**Vista:** `ct-necesidades` (L4776) · `loadNecesidades` (L26404) → `renderNecesidades` (L26426) · roles: admin/compras
**Lee/escribe:** `clientes/{id}/necesidades` (`categoria,estado,periodicidad,items[],cotizaciones[],estadoCotizacion,creadoEn,eliminado`). Lee `prodCompra`, `proveedores`, `_stockInsumos`/`_productos` (para vínculo).
**Orden** (L26411): sin-cotizar → en-cotización → con-oc; secundario por urgencia (`urgente/proximo/programado`).
**KPIs** (L26428): `nc-kpi-urgente/proximo/programado` por `estado`.
**Filtros** (L4801): `nc-filtro-estado` (`sin-cotizar`/`en-cotizacion`/`con-oc`) + `nc-filtro-cat` → `filtrarNecesidades()` (L26516).

### Lista (`nc-lista`, L26478)
Card por necesidad: `categoria`, badge estado, badge cotización (`Sin cotizar`/`En cotización`/`Con OC`), lista `items` (`nombre × cant unidad`).
- `PDF` → `generarPDFNecesidad(id)` (L26985)
- Si `con-oc`: `ver OC` → `verOCsDeNecesidad(id)` (L26518, busca OC con `ncId`); si no: `Cotizar` → `abrirCotizacion(id)`
- `eliminar` → `deleteNecesidad(id)` (L26616) soft-delete.
- Vacío: onboarding 3 pasos + `+ Nueva necesidad`.

### Modal Nueva necesidad (`newNecesidadModal`) · `saveNecesidad` (L26590)
- `nc-cat` (req, select categorías) · `nc-estado` · `nc-periodicidad` · selección productos por categoría (`filtrarProdsNecesidad` L26552, checkboxes `ncp-<id>` + cantidad `ncq-<id>`, `toggleProdNC`).
- `+ Nuevo producto` inline → `abrirProdDesdeNC()` (L26342, abre `newProdCompraModal` z-index 2000).
- Ítems (L26596): `{id,nombre,unidad,cantidad, ...vínculo stock}`. **Auto-sugiere vínculo** con `_matchVinculoStock(nombre)` (match exacto normalizado vs insumos/productos, L27329) — propaga a la OC vía cotización.
- **Escribe** `necesidades` {categoria,estado,periodicidad,items,cotizaciones:[],creadoEn} → `loadNecesidades`.

### Cotización → OC (`cotizacionModal`, wizard 3 pasos)
`abrirCotizacion` (paso1 elegir proveedores) → `cotPaso3` (L26877) arma OC por proveedor (elige menor precio o selección manual `_seleccionFila`) → `confirmarOC` (L26949):
- **Escribe** por cada OC: `ordenesCompra` {numero,proveedor,proveedorId,items,total,fecha,ncId,estadoPago:'pendiente',estadoRecepcion:'emitida',creadoEn} (L26959).
- **Escribe** `necesidades/{ncId}` {cotizaciones:[{proveedorId,proveedor,total}],estadoCotizacion:'con-oc'} (L26966).
- `loadNecesidades`+`loadOrdenesCompra`, abre detalle 1ª OC.

---

## Compras — Órdenes de compra
**Vista:** `ct-ordenes-compra` (L4817) · `loadOrdenesCompra` (L27174) → `renderOrdenesCompra` (L27191) · roles: admin/compras
**Lee/escribe:** `clientes/{id}/ordenesCompra` (`numero,proveedor,proveedorId,items[],total,fecha,ncId,notas,estadoPago,estadoRecepcion,fechaRecepcion,totalRecibido,creadoEn,eliminado`). Items OC: `{nombre,productId,cantidad,precioUnit,total,insumoId,insumoNombre,insumoUnidad,productoId,productoNombre,cantidadRecibida}`.
**Orden:** por `numero` desc (L27181).
**KPIs** (L27193): `oc-kpi-total`, `oc-kpi-recibidas` (estadoRecepcion=recibida), `oc-kpi-pend-recibir` (=emitida).
**Filtros** (L4840): `oc-search` (N°/proveedor) + `oc-filtro-recepcion` (emitida/recibida) → `filtrarOCsLista()` (L27273).

### Lista (`oc-lista`, L27250)
Fila: `OC-###`, proveedor + `N ítems`+fecha, monto (`_ocMontoReal`), pill recepción (`Recibida` verde / `Pendiente` → click `marcarOCRecibida`), ver detalle → `abrirDetalleOC`, eliminar → `eliminarOC`.
Vacío: onboarding + `+ Nueva OC`.

### Nueva OC directa (botón `+` header → `abrirNuevaOCDirecta` L27480)
Modal `modal-nueva-oc-directa`. Precarga proveedores/prodCompra/stockInsumos.
- `noc-proveedor` (req) · `noc-fecha` (hoy ARG) · `noc-notas` · ítems `_nocItems` (L27276).
- Ítem: autocomplete producto (`nocBuscarProducto`/`nocSeleccionarProducto`), opción `Otro (texto libre)`, `+ Nuevo producto` → `abrirProdDesdeOC`; cantidad; precio; campo **Vincular con stock** (autocomplete `_nocBuscarInsumo` insumos+productos reventa, `_nocSelVinc`).
- **Auto-sugiere vínculo** al elegir producto: `_matchVinculoStock(nombre)` (L27346).
- `guardarNuevaOCDirecta` (L27520): valida prov+ítems+precios>0. `nextNum=max(numero)+1`. **Escribe** `ordenesCompra` {numero,proveedor,proveedorId,items[],total,fecha,ncId:null,notas,estadoPago:'pendiente',estadoRecepcion:'emitida',creadoEn}. Abre detalle.

### Detalle OC (`ocDetalleModal` · `abrirDetalleOC` L27593)
Muestra número, proveedor, total (recibido vs pedido si aplica), ítems (cols cambian si `mostrarRecibido`: Pedido/Recibido/P.Unit/Total). Botón `generarPDFOrdenCompra` (L27828, jsPDF: header negocio, proveedor, ítems, total, firma). Si emitida, permite recibir.

### Recepción (`ocRecepcionModal` · `marcarOCRecibida` L27687 → `confirmarRecepcionOC` L27805 → `ejecutarRecepcionOC` L27722)
Solo si `estadoRecepcion==='emitida'`. Editor cantidad recibida por ítem (`ocRecSetCant`, total en vivo `ocRecActualizarTotal`).
- **Escribe** `ordenesCompra/{id}` {estadoRecepcion:'recibida',fechaRecepcion:hoy,items:itemsConRec(`cantidadRecibida`),totalRecibido} (L27736).
- **Escribe factura auto CC**: si `proveedorId` y no existe factura con ese `ocId` → `proveedores/{pid}/facturas` {numero:`OC-###`,monto:totalRecibido,fecha,ocId,desc:`Recepción OC-###`,estado:'pendiente',esOC:true} (L27746).
- **Stock (writeBatch)**: ítems con `insumoId` → `insumos/{id}.stockActual = increment(cantRecibida)`, actualiza `costoUnitario` si precio>0, + `movimientosStock` {tipo:'entrada',origen:'compra',referenciaId:ocId}; ítems con `productoId` (reventa) idem sobre `productos/{id}` (L27754-27782). Refresca `loadProductos`/`loadStockModule`.
- **Aviso "nada muere en silencio"** (L27785): ítems recibidos sin vínculo pero que matchean por nombre exacto un insumo/producto existente → `showConfirm` "Stock no actualizado" (contá `sinVinculoConMatch`).
- Refresca lista + CC si abierta.

### Eliminar OC (`eliminarOC` L27562)
Soft-delete `ordenesCompra/{id}` {eliminado}; también soft-delete factura `esOC` asociada en CC del prov; refresca lista/proveedores/CC.

---

## Compras — Historial
**Vista:** `ct-historial-compra` (L4854) · `renderHistorialCompra(q)` (L27979) · carga vía `loadOrdenesCompra().then(renderHistorialCompra)` (L31450) · roles: admin/compras
**Lee:** `_ordenesCompra` (todas, incluye emitidas — no solo recibidas). Solo lectura, no escribe.
**Agrupa** por nombre de producto (línea de cada `items[]`), ordena líneas por fecha desc.
**KPIs** (L28030): `hc-kpi-ocs` (total OC), `hc-kpi-prods` (productos distintos), `hc-kpi-total` (Σ `_ocMontoReal`).
**Filtro:** `hc-search` por nombre producto → `buscarHistorialCompra` (L28084).
**Card por producto:** N compras, último precio, badge variación % (`(max-min)/min`), tabla líneas (OC, proveedor, fecha, P.Unit).
Vacío: onboarding "Sin historial de compras".

---

## Compras — Productos de compra (config)
**Vista:** `ct-prod-compra` (L4737) · `loadProductosCompra` (L26273) → `renderProductosCompra` (L26287) · roles: admin/compras
**Lee/escribe:** `clientes/{id}/prodCompra` (`nombre,categoria,unidad,descripcion,creadoEn,eliminado,eliminadoEn`).
**KPIs** (L26290): `pc-kpi-total`, `pc-kpi-cats` (categorías distintas), `pc-kpi-top`.
**Filtro:** `pc-search` → `filtrarProductosCompra` (L26350).

### Lista (`pc-lista`, L26326)
Fila: nombre+descripción, categoría (pill), unidad, editar/eliminar. Vacío: onboarding + `+ Nuevo producto`.

### Modal (`newProdCompraModal`) · `saveProdCompra` (L26355)
- `pc-nombre` (req) · `pc-cat` (req, select categorías) · `pc-unidad` (lowercase) · `pc-desc` · `pc-edit-id`.
- **Escribe** `prodCompra` add/update {nombre,categoria,unidad,descripcion,creadoEn}.
- Post-guardado reengancha origen: `_prodDesdeNC` (recarga selector NC) o `_prodDesdeOC` (selecciona en ítem OC).
- `editProdCompra(id)` (L26386) precarga · `deleteProdCompra(id)` (L26397) soft-delete.

---

## Compras — Categorías (de proveedor)
**Vista:** `ct-categorias-compra` (L4882) · `loadCatsProveedor` (L30104) → `renderCatPanel` (L30193) + `renderCatSelect` (L30118) · roles: admin/compras
**Lee/escribe:** `clientes/{id}/categoriasProveedor` (`nombre,creadoEn,eliminado,eliminadoEn`).
**Base (no borrables):** `CATS_DEFAULT` (L30100) = Librería y papelería, Materiales, Mano de obra, Servicios profesionales, Alquiler, Herramientas y equipos, Marketing y publicidad, Logística y transporte, Reparaciones, Tecnología y software, Limpieza e higiene, Otro.
**Carga** (L30104): `_catsProv = [...CATS_DEFAULT, ...custom no-eliminados]`. Sin cliente usa solo defaults.
**`renderCatSelect(valor)`** (L30118) rellena los 3 selects: `nprov-cat` (proveedor), `nc-cat` (necesidad), `pc-cat` (producto).

### Panel (`prov-cats-lista`, L30193)
Fila: nombre, badge `Base`/`Custom`. Solo custom tiene botón eliminar → `deleteCatCustom` (L30174) soft-delete (proveedores/productos con esa cat no se modifican).
KPIs banner: `bn-cat-total/predet/custom`.

### Nueva categoría (botón `+` → `mostrarFormNuevaCat` L30143)
Form `prov-nueva-cat-form`: `prov-nueva-cat-input` → `guardarCatDesdePanel` (L30152). Valida duplicado. **Escribe** `categoriasProveedor` {nombre,creadoEn}; actualiza `_catsProv` + re-render selects/panel.
(Variante desde modales: `mostrarNuevaCat`/`guardarNuevaCat` L30215/30222, mismo destino.)


---


# 08 — Stock y Producción

SPA multi-tenant. Todo bajo `clientes/{currentClientUID}/<subcolección>`. Módulos **Stock** (5 vistas) y **Producción** (1 vista).

## Gating por plan (single source of truth)
- `PLAN_FEATURES` (~33392): `esencial` → `stock:false, produccion:false`; `pro` → `stock:true, produccion:false`; `premium` → `stock:true, produccion:true`.
- `tieneAccesoPlan(feature,cd)` (~33424) lee `PLAN_FEATURES[_planActual(cd)][feature]`. `normalizarPlan`: `base/esencial`→esencial, `pro`→pro, `premium`→premium, resto→esencial.
- `showCTab` (~31393) `_planGate` (~31417): `insumos/recetas/movimientos-stock/productos-stock` → `feat:'stock' plan:'pro'`; `produccion` → `feat:'produccion' plan:'premium'`. Si no hay acceso → `_proLockEnTab('ct-'+tab, titulo, true, plan)` y corta (no carga datos).

## Roles (mapas ~33367)
- `_MOD_POR_ROL`: `stock:['stock']`, `produccion:['produccion']`, `admin:null` (sin filtro).
- `_TAB_POR_ROL`: `stock:['insumos','recetas','movimientos-stock']`, `produccion:['produccion']`. (Nota: `productos-stock` NO está en tabs del rol `stock`.)
- `tieneAccesoATab(tab)` / `tieneAccesoAModulo(mod)`: admin siempre; operador pasa si CUALQUIER rol lo habilita.
- Producción-específico: `_prodPuedeCrearOrden` / `_prodPuedeEjecutar` (~20143,20551) → `currentRol==='admin' || currentRol==='produccion'`.
- Filtro sub-items sidebar Stock para rol `produccion` sin editor de stock (~33618): oculta todo menos `produccion` e `insumos`. Roles que editan stock/insumos: `['compras','stock','admin']`. Clase body `es-{rol}` (skip `es-produccion` si ya tiene editor de insumos).
- Navegación: `showClientMod('stock')` (~31312) → subnav-stock + `showCTab('insumos')`; `showClientMod('produccion')` → `showCTab('produccion')`. `sidebarNav('stock',sub)` (~35168) mapea insumos/productos/recetas/movimientos. Rol `produccion` autonav a `sidebarNav('produccion')` post-login (~8013).
- `renderInsumos()` (~10320) es del **calculador de costos** (`calcf-insumos-wrap`), NO del módulo Stock. Fuera de alcance.

---

## Stock — Insumos
**Vista:** `ct-insumos` (~4912) · `loadStockModule` (~18970) → `stkRenderInsumos` (~18979) · gating: plan Pro (feat `stock`) · roles: admin, stock, (compras edita)
**Lee/escribe:** `clientes/{id}/insumos` campos `nombre, unidad, stockActual, stockMinimo, costoUnitario, activo, creadoEn`. También escribe `movimientosStock` en ajustes.

`loadStockModule`: `getDocs(query(insumos, where('activo','==',true), orderBy('nombre','asc')))` → cache `window._stockInsumos`. Render llama `stkRenderInsumos`.

### KPIs (header)
- `stk-kpi-total` → `ins.length`
- `stk-kpi-critico` → count de `stockMinimo!=null && stockActual<=stockMinimo`
- `stk-kpi-costo` → Σ `stockActual*costoUnitario`
- Welcome (`stk-insumos-welcome`) si `!ins.length`, si no `stk-insumos-content`.

### Listado (`stk-insumos-lista`)
- Fila por insumo (desktop / mobile card ≤768px). Muestra `nombre`, badge `BAJO` si `stockActual<=stockMinimo`, `unidad`, `stockActual`, `stockMinimo` (o `—`), `costoUnitario` (o `—`).
- `click fila` / botón editar → `stkEditarInsumo(id)`.

### Modal insumo (`stock-insumo-modal`)
- `stkNuevoInsumo()` (~19047) → abre en modo alta (oculta botón eliminar). Botón "+" header (`stk-ins-plus-menu` → opción "Insumo").
- `stkEditarInsumo(id)` (~19060) → carga `stk-nombre, stk-unidad, stk-stock-inicial(=stockActual), stk-stock-minimo, stk-costo`; muestra eliminar.
- `stkGuardarInsumo()` (~19075) · valida `nombre` obligatorio ·
  - Alta: `addDoc(insumos)` con `{nombre, unidad, stockMinimo(null si vacío), costoUnitario(null si vacío), activo:true, stockActual=parseFloat(stk-stock-inicial)||0, creadoEn}`.
  - Edición: `updateDoc(insumos/{id})` con `{nombre,unidad,stockMinimo,costoUnitario,activo:true}` — NO toca `stockActual` (el stock inicial solo se setea al crear).
  - Cierra modal + `loadStockModule()`.
  - **Wrap** (~19668): si venía de crear insumo desde receta (`_stkRecetaItemPendiente`), reselecciona el último insumo en la línea de receta y reabre `stock-receta-modal`.
- `stkEliminarInsumo()` (~19104) → `showConfirm` → `updateDoc(insumos/{id},{activo:false})` (soft-delete, preserva movimientos) + reload.

### Modal ajuste de stock (`stock-ajuste-modal`)
- `stkAjusteModal()` (~19118): puebla `stk-aj-insumo` con `_stockInsumos`; tipo default `entrada`. Abierto desde `stk-ins-plus-menu` → "Ajuste de stock".
- `stkGuardarAjuste()` (~19131) · valida insumo + cantidad>0 ·
  - `delta = tipo==='entrada' ? +cantidad : -cantidad`; `stockResultante = stockActual+delta`.
  - `updateDoc(insumos/{id},{stockActual: increment(delta)})`.
  - `addDoc(movimientosStock,{tipo:'ajuste', insumoId, insumoNombre, cantidad, delta, unidad, stockResultante, origen:'ajuste', referenciaId:'', notas, fecha:fechaHoyARG(), creadoEn})`. `notas` = motivo select (o texto "Otro").
  - Toast warning si `stockResultante<0`. Cierra + reload.
- Export: `exportarStkInsumosExcel()` (~19843) — XLSX de insumos con valor total.

---

## Stock — Productos de stock
**Vista:** `ct-productos-stock` (~4991) · `loadProductosStockModule` (~19160) → `prdStkRenderProductos` (~19168) · gating: plan Pro (feat `stock`) · roles: admin (tab no incluido en rol `stock` de `_TAB_POR_ROL`)
**Lee/escribe:** `clientes/{id}/productos` campos `nombre, manejaStock, eliminado, stockActual, stockMinimo, costoUnitario, updatedAt`. Escribe `movimientosStock` en ajustes.

`loadProductosStockModule`: asegura cache `window._productos` (`loadProductos`), filtra `manejaStock===true && !eliminado`. NO consulta Firestore propio: reusa productos del catálogo con toggle "Stock". Se accede vía `sidebarNav('stock','productos')`.

### KPIs
- `prdstk-kpi-total` → nº productos con stock; `prdstk-kpi-critico` → `stockActual<=stockMinimo`; `prdstk-kpi-valor` → Σ `stockActual*costoUnitario`.
- Welcome (`prdstk-prods-welcome`) linkea al catálogo si no hay productos con `manejaStock`.

### Listado (`prdstk-prods-lista`)
- Fila: `nombre`, badge `BAJO`, `stockActual` (rojo si bajo/negativo), `stockMinimo`, `costoUnitario`. Click/botón → `prdStkAjusteModal(prodId)`.

### Modal ajuste producto (`stock-ajuste-producto-modal`)
- `prdStkAjusteModal(prodId)` (~19274): selector `prdstk-aj-selector` con productos `manejaStock`; `prdStkAjusteCambiarProducto` refleja stock/min/costo. Botón "+" header abre con `''`.
- `prdStkAjusteSetTipo('entrada'|'salida')` (~19242) — pills.
- `prdStkGuardarAjusteProducto()` (~19294) · valida producto + cantidad>0 ·
  - `delta = ±cantidad`; `stockResultante = stockActual+delta`.
  - `updateDoc(productos/{prodId},{stockActual:increment(delta), stockMinimo, costoUnitario, updatedAt})` — el modal permite editar min/costo del producto.
  - `addDoc(movimientosStock,{tipo:'ajuste', insumoId:prodId, insumoNombre, cantidad, delta, unidad:'u', stockResultante, origen:'ajuste', referenciaId:'', notas, itemTipo:'producto', fecha, creadoEn})`.
  - Toast warning si negativo. Cierra + reload. Export: `exportarPrdStkExcel`.

---

## Stock — Recetas
**Vista:** `ct-recetas` (~5044) · `loadRecetasModule` (~19352) → `stkRenderRecetas` (~19365) · gating: plan Pro (feat `stock`) · roles: admin, stock
**Lee/escribe:** `clientes/{id}/recetas` campos `itemId, itemNombre, itemTipo('producto'|'insumo'), items[], costoTotal, activo, creadoEn, rendimiento`. Lee `_stockInsumos` (costos) y `_productos`. Legacy: `productoId/productoNombre`.

`loadRecetasModule`: `getDocs(query(recetas, where('activo','==',true)))` → `_stockRecetas`, ordena por `itemNombre||productoNombre`.
Cada `items[]` de una receta: `{insumoId, insumoNombre, cantidad, unidad, unidadBase, cantidadBase}`. `unidadBase` = unidad del insumo; `cantidadBase` = cantidad convertida a la unidad base (para descuento real).

### KPIs / Listado
- `stk-kpi-recetas` → nº recetas; `stk-kpi-costo-rec` → promedio de `costoTotal`.
- Fila (`stk-recetas-lista`): `itemNombre` + badge INSUMO/PRODUCTO (`itemTipo`), resumen de insumos, `costoTotal`. Click → `stkEditarReceta(id)`.

### Modal receta (`stock-receta-modal`)
- `stkNuevaReceta()` (~19442): tipo default `producto`, items vacíos. Botón "+" header (`stkNuevaReceta`).
- `stkRecSetTipo('producto'|'insumo')` (~19407): pill + input `stk-rec-item-tipo`; cambia label/placeholder; una receta puede producir un **producto del catálogo** o un **insumo** (para sub-recetas).
- `stkEditarReceta(id)` (~19453): carga dueño (`itemId/itemNombre/itemTipo`, fallback `productoId`) e `items` (re-hidrata `unidadBase/unidad` desde insumo).
- Selección de dueño: `stkBuscarItemRec` (~19472, busca en insumos o productos según tipo) / `stkSeleccionarItemRec`. Escribe `stk-rec-item-id`.
- Líneas de insumo (`_stkRecetaItems`, render `stkRecRenderItems` ~19536):
  - `stkRecAgregarItem` / `stkRecQuitarItem`.
  - Buscar insumo por línea: `stkBuscarInsumoItem`/`stkSeleccionarInsumoItem` (~19556/19583). Opción **"+ Crear como insumo nuevo"** → `stkCrearInsumoDesdeReceta` (~19602) abre modal insumo, al guardar reengancha.
  - `stkRecItemCantidad` / `stkRecItemUnidad`. Unidad restringida a compatibles: `_stkUnidadesCompatibles` (kg↔g, l↔ml↔cc).
  - Conversión: `_stkConvertirABase(cant, unidadUsada, unidadBase)` (~19524) — factores kg/g/l/ml/cc.
- Costo en vivo: `stkRecActualizarCosto` (~19617) = Σ `cantidadBase * costoUnitario(insumo)` → `stk-rec-costo-total`.
- `stkGuardarReceta()` (~19628):
  - Valida dueño seleccionado + ≥1 insumo.
  - **Unicidad**: rechaza si ya existe receta activa para el mismo `itemId`+`itemTipo` (legacy fallback `productoId`).
  - Calcula `costoTotal`; `items` filtrados a los que tienen `insumoId`, cada uno con `cantidadBase` recomputado.
  - `data={itemId,itemNombre,itemTipo,items,costoTotal,activo:true}`. Alta agrega `creadoEn`, `rendimiento:1`.
  - Alta `addDoc(recetas)` / edición `updateDoc(recetas/{id})`. Cierra + `loadRecetasModule()`.

---

## Stock — Movimientos
**Vista:** `ct-movimientos-stock` (~5104) · `loadMovimientosStock` (~19681) → `_stkRenderMovs` (~19720) · gating: plan Pro (feat `stock`) · roles: admin, stock
**Lee:** `clientes/{id}/movimientosStock` (solo lectura; se escribe desde ajustes/ventas/presupuestos/compras/producción). Campos: `tipo('entrada'|'salida'|'ajuste'), insumoId, insumoNombre, cantidad, delta(ajustes), unidad, stockResultante, origen, referenciaId, notas, itemTipo, fecha, creadoEn`.

`loadMovimientosStock`: `getDocs(query(movimientosStock, orderBy('fecha','desc'), limit(100)))` → `_stkMovs` (re-sort fecha/creadoEn desc). Puebla selector de meses (`stk-mov-mes-sel`) desde enero al mes actual. Welcome si vacío.

### KPIs (del mes seleccionado)
- `stk-kpi-movs` → total del mes; `stk-kpi-entradas` → `tipo==='entrada'`; `stk-kpi-salidas` → `tipo==='salida'`.

### Filtros / Listado
- `stk-mov-mes-sel` onchange → `stkMovFiltrar()` (`_stkMovMes`).
- Chips tipo (`stk-mov-chip`): `''`(Todos)/`entrada`/`salida`/`ajuste` → `stkMovChip` (`_stkMovTipo`).
- `_stkRenderMovs(mes,tipo)`: filtra por `fecha.slice(0,7)===mes` y tipo. Fila muestra `fecha`, badge tipo, `insumoNombre`+`notas`, `origen` (label: compra/venta caja/presupuesto/ajuste manual), cantidad con signo.
  - Signo: entrada `+` verde; salida `−` rojo; ajuste usa signo de `delta` (movs viejos sin `delta` → `−` rojo).
- Export (`stk-mov-dl-menu`): `exportarStkMovsExcel` (~19789) / `exportarStkMovsCsv` (~19822), del mes activo.

### Escritores de movimientos (fuera de la vista)
- `_triggerStockPorVenta(carrito,refId)` (~19878, origen `venta`) y `_triggerStockPorPresupuesto(p)` (~19945, origen `presupuesto`):
  - **Precedencia manejaStock**: si el producto tiene `manejaStock===true`, descuenta del PRODUCTO (`increment(-qty)`, unidad `u`, `itemTipo:'producto'`) y NO toca receta.
  - Si no maneja stock: busca receta activa del producto (`itemId+itemTipo==='producto'`, fallback `productoId`) y descuenta cada insumo: `deltaBase = cantidadBase*qty` sobre `stockActual`; movimiento con `cantidadShow` (unidad de receta). `stockResultante` estimado de cache (no atómico).
- Compras/OC recibidas escriben `entrada` origen `compra` (módulo compras).
- Producción escribe origen `produccion` (ver abajo).

---

## Producción
**Vista:** `ct-produccion` (~5191) · `loadProduccionModule` (~20300) → `prodRender` (~20316) · gating: plan **Premium** (feat `produccion`) · roles: admin, produccion
**Lee/escribe:** `clientes/{id}/ordenesProduccion`; `config/contadores.ultimoProduccion` (correlativo `P-####`). Descuenta `insumos`, incrementa `insumos`/`productos`, escribe `movimientosStock`. Lee `_stockRecetas`, `_productos`, `_stockInsumos`.

`loadProduccionModule`: asegura caches (`_productos`, `_stockInsumos` via loadStockModule, `_stockRecetas` via loadRecetasModule), luego `prodCargarOrdenes` + `prodRender`.
`prodCargarOrdenes` (~20127): `getDocs(ordenesProduccion)`, filtra `!eliminado`, ordena `creadoEn` desc → `_ordenesProduccion`.

**Modelo orden**: `{numero:'P-####', estado('pendiente'|'en_curso'|'finalizada'), sector, lineas[], notas, creadoEn, creadoPor, updatedAt, eliminado:false}`.
**Línea**: `{lineaId, itemId, itemNombre, itemTipo('producto'|'insumo'), rubro, cantidad, estado('pendiente'|'iniciada'|'finalizada'), iniciadaEn/Por, finalizadaEn/Por}`.
Estado orden derivado `_prodCalcularEstadoOrden` (~20082): todas finalizadas→`finalizada`; alguna iniciada/finalizada→`en_curso`; si no→`pendiente`.

### KPIs (`prodRender`)
- `prod-kpi-items` → nº ítems producibles (= recetas activas cruzadas con producto/insumo).
- `prod-kpi-encurso` → órdenes `estado==='en_curso'`.
- `prod-kpi-bajo` → producibles con `stockActual<stockMinimo`.

### Tabla "Stock de producción" (`prod-stock-lista`)
- Producibles = recetas activas (`itemId||productoId`), stock desde producto/insumo. Badge INSUMO/MOSTRADOR. Botón **Producir** → `prodAbrirNuevaOrden(itemId,itemTipo)`. Si sin recetas: aviso "Creá una receta primero".

### Órdenes (`prod-ordenes-lista`)
- Chips filtro (`prod-filtros-chips`): todas/en_curso/pendiente/finalizada → `prodSetFiltroEstado` (`_prodFiltroEstado`).
- `prodRenderOrdenes` (~20437): orden en_curso→pendiente→finalizada, luego creadoEn desc. Fila: `numero`, badge sector, fecha, nº ítems, chip `creadoPor`, badge estado. Click → `prodAbrirDetalle`.

### Modal Nueva orden (`prod-nueva-orden-modal`)
- `prodAbrirNuevaOrden(itemId?,itemTipo?)` (~20555): valida `_prodPuedeCrearOrden` (admin/produccion) y que haya producibles. Precarga línea si viene de "Producir".
- Multi-línea (`_prodOrdenLineas`): `prodRenderLineas` (~20577) — select ítem (`tipo|id`) + cantidad. `prodAgregarLinea`/`prodQuitarLinea`/`prodLineaSetItem`/`prodLineaSetCantidad`. Campos `prod-orden-sector`, `prod-orden-notas`.
- `prodGuardarOrden()` (~20637): filtra líneas con `itemId` + `cantidad>0`; error si ninguna. Llama `prodCrearOrden`.
- `prodCrearOrden(lineas,notas,sector)` (~20089): genera `numero` vía `_getNextProduccionNum` (~20071, `runTransaction` sobre `config/contadores.ultimoProduccion`, formato `P-####`). Normaliza líneas (todas `estado:'pendiente'`). `addDoc(ordenesProduccion, {numero,estado,sector,lineas,notas,creadoEn,creadoPor:_prodNombreUsuarioActual(),updatedAt,eliminado:false})`. Recarga módulo.

### Modal detalle (`prod-detalle-modal`) — ejecución
- `prodAbrirDetalle(ordenId)` (~20479): header numero + sector + badge estado; lista líneas con badge tipo/estado, botones y autoría (iniciada/finalizada por + hora); notas.
- **Iniciar línea** `prodIniciarLinea(ordenId,lineaId)` (~20176) — solo `estado==='pendiente'`:
  - Requiere `_prodPuedeEjecutar` (admin/produccion). Requiere receta activa del ítem (`itemId+itemTipo`, fallback `productoId`); si no → warning.
  - `showConfirm` → por cada `receta.items`: `deltaBase = cantidadBase*qty`, descuenta `updateDoc(insumos/{id},{stockActual:increment(-deltaBase)})` + actualiza cache.
  - `addDoc(movimientosStock,{tipo:'salida', insumoId, insumoNombre, cantidad:cantidadShow, unidad, stockResultante, origen:'produccion', referenciaId:ordenId, notas:'Producción P-####: <item>', fecha, creadoEn})`.
  - `_prodActualizarLinea` → línea `estado:'iniciada', iniciadaEn, iniciadaPor`; recalcula estado orden; `updateDoc(ordenesProduccion/{id},{lineas,estado,updatedAt})`. Re-render + reabre detalle.
- **Finalizar línea** `prodFinalizarLinea(ordenId,lineaId)` (~20248) — solo `estado==='iniciada'`:
  - `showConfirm` → suma al stock del ítem producido: `col = itemTipo==='insumo'?'insumos':'productos'`; `updateDoc(col/{itemId},{stockActual:increment(qty)})`.
  - `addDoc(movimientosStock,{tipo:'entrada', insumoId:itemId, insumoNombre, cantidad:qty, unidad(insumo.unidad o 'u'), stockResultante, origen:'produccion', referenciaId:ordenId, notas:'Producción P-####', itemTipo, fecha, creadoEn})`.
  - `_prodActualizarLinea` → `estado:'finalizada', finalizadaEn, finalizadaPor`. Re-render + reabre.
- Autoría: `_prodNombreUsuarioActual` (~20148) = negocioNombre/nombre si admin, si no `currentOperadorNombre`.

### Notas de flujo de stock (Producción)
- Iniciar = CONSUME insumos de la receta (salida). Finalizar = GENERA el ítem terminado (entrada). El descuento/incremento es por línea, no atómico transaccional (usa `increment` + `stockResultante` estimado de cache para historial).
- No hay borrado real de órdenes: `eliminado:true` (flag; no se observó UI de borrado en las funciones leídas).


---


# Control del negocio + Gestión

**Módulo interno:** `herramientas` (label sidebar/topbar antiguo "Herramientas"; label sidebar nuevo "Control del negocio"). Sub-tabs en `#subnav-herramientas`: `calculador` (Calculador), `kpis` (Indicadores), `tareas` (Plan de acción).
**"Gestión"** = grupo de sidebar aparte (`sbg-gestion`) pero NO es módulo real: `sidebarNav('gestion','planaccion')` hace `showClientMod('herramientas')` + `showCTab('tareas')` (índice 35163). Solo apunta a Plan de acción.
**Roles/gating:** `showClientMod('herramientas')` y `showCTab('calculador'|'kpis'|'tareas')` → bloqueados para `cajero` (no está en su whitelist) y para roles de sistema sin acceso (`tieneAccesoAModulo`/`tieneAccesoATab`). `_MOD_POR_ROL`/`_TAB_POR_ROL` no listan herramientas/kpis/tareas para comercial/compras/vendedor/produccion/stock → **solo `admin`/dueño** (admin=`null`=sin filtro). En `PLAN_FEATURES` `herramientas`+`gestion` están en los 3 planes (esencial/pro/premium): no se gatea por plan.
**Todas las escrituras** viven en `clientes/{currentClientUID}/<subcolección>`. Tracking de sesiones: `showClientMod` wrappeado registra permanencia por módulo (label `herramientas`→"Control del negocio", `gestion`→"Gestión").

---

## Control — Calculador de costos
**Vista:** `ct-calculador` (~4381) · `loadCalcItems(clientId)` (9986) carga al abrir cliente (8026). Dos sub-vistas: `#calc-list-view` (lista) y `#calc-form-view` (crear/editar).
**Lee/escribe:** `clientes/{id}/calculos`. Cache en `calcData{}`. Campos por doc: `nombre`, `margen` (int %), `unidades`, `tipo:'producto'`, `insumos[]`, `costosDirectos[]`, `costoTotal`, `precioSugerido` (denormalizados), `creadoEn`, `actualizadoEn` (ISO), `eliminado`, `eliminadoEn`.
- `insumos[]` (schema nuevo): `{nombre, compraQty, compraUnit, precio, usoPorUnidad}`.
- `costosDirectos[]`: `{nombre, monto}`.
- **Schema viejo** (no editable, ver abajo): `tipo:'hora'|'proyecto'`, insumos con `eqQty/eqUnit/tipoUso('cantidad'|'durabilidad')/usoPorUnidad/usosTotal`, `costosFijos/horasMes/horasEstimadas/tarifaHora/costosDirectos`.

**Cálculo** (`saveCalc`/`recalcCalc`):
- Costo insumo = `(precio / compraQty) * usoPorUnidad`. `costoTotal` = Σ insumos + Σ `costosDirectos.monto`.
- `precioSugerido` = `costoTotal * (1 + margen/100)`. Ganancia = precio − costo. `pct` margen sobre precio = `gan/precio`.
- Lista usa `_calcItemMetrics(c)`: prefiere `costoTotal`/`precioSugerido` denormalizados; fallback recalcula según `tipo` (`calcCostoProducto` para producto; hora/proyecto legacy).

### Banner lista (KPIs) — `renderCalcList` (10030)
- `calc-kpi-count` → nº cálculos activos (no eliminados) · `calc-kpi-margen` → margen promedio · `calc-kpi-top`/`calc-kpi-bajo` → nombre del de mayor/menor margen. Lee `calcData`.

### Tabla "Mis cálculos" — `renderCalcList` inyecta en `#calc-table-wrap`
- Buscador `#calc-buscador` → filtra por nombre (`_calcFiltrar`). Orden por columna `_calcSortBy('nombre'|'costo'|'precio'|'margen'|'actualizadoEn')`.
- Fila → `showCalcForm(id)` (editar). Badge "Revisar precios" si `actualizadoEn` > 90 días. Tema color por margen (`getTema`): >150 excelente / ≥60 saludable / ≥20 mejorable / <20 bajo.
- `⋯` `calcMenuOpc(id)` → menú Editar / Eliminar.
- Empty state con onboarding 3 pasos + `showCalcForm(null)`.

### Form nuevo/editar — `showCalcForm(id)` (10575) · `#calc-form-view`
- `showCalcForm(null)` → nuevo (1 insumo + 1 directo vacíos). `showCalcForm(id)` → lee `getDoc(...calculos/id)`, precarga. **Si `tipo==='hora'|'proyecto'`** (schema viejo) → toast "formato anterior, no editable" + vuelve a lista.
- `#calcf-margen` slider (1–1000) ⇄ `#calcf-margen-manual` (`calcfSyncSlider`/`calcfSyncManual`). `#calcf-nombre`, `#calcf-unidades`.
- `calcfAddInsumo(data?)` (10431) → card `.calcf-ins-card` con `.calcf-ins-n/-cq/-cu/-p/-u` (nombre/cantComprada/unidad/precio/usoPorUnidad). Unidades: kg,lt,g,ml,und,mts,rollo,frasco,caja. Botón "Agregar insumo".
- `calcfAddDirecto(data?)` (10461) → row `.calcf-dir-row` con `.calcf-dir-n/-m`. Botón "Agregar costo directo".
- `recalcCalc()` (10475) → recalcula en vivo (banner KPIs `calcf-kpi-precio/-costo/-ganancia/-margen-live`, recibo `#calcf-recibo-wrap`, termómetros, mensaje). Tema por `pct`: <15 low / <30 ok / <55 good / ≥55 great (`calcfGetTema`, `CALCF_TEMAS`).
- **Guardar:** `saveCalc()` (10625). Valida nombre no vacío. Junta insumos (solo con nombre) + directos (nombre y monto>0), calcula `costoTotal`/`precioSugerido`, arma `data` (fuerza `tipo:'producto'`, `eliminado:false`). `id` → `updateDoc`; sin id → `addDoc` + guarda ref.id. Toast `#calcf-saved`, vuelve a lista + `renderCalcList`. Actualiza `calcData`.
- `showCalcList()` (10620) → volver (sin guardar).
- **Eliminar:** `deleteCalc(id)` (10710) → `showConfirm` → `updateDoc {eliminado:true, eliminadoEn}` (soft-delete), borra de `calcData`, re-render.
- **Express** (`toggleExpressPanel`/`recalcExpress`): calculadora rápida efímera costo→precio, no persiste.

**Vínculo con catálogo:** NO hay vínculo directo calculos↔catálogo/productos. Catálogo de precios es otro tab (`ct-productos`, colección `productos`, `abrirNuevoProducto`/`guardarPrecios`) fuera de este alcance.

---

## Control — Indicadores
**Vista:** `ct-kpis` (~3891, título "Mis indicadores") · sub-tab `kpis`. Al abrir (`showCTab('kpis')`, 31431): precarga contabilidad/presupuestos/mcClientes/cajaSaldo/cierreConfig/cierres si faltan, luego `filterCkByRango(default)` + `_ckSyncLabel`.
**Fuentes (solo lectura, in-memory):** `window._clientIngresos`, `_clientEgresos`, `_clientPresupuestos`, `_mcClientes`, `_clientCierres`, `_clientVentas`, `_reservaTotal`, `_cuentasDuenoNombres`, `_cprdParticipantes`. **No escribe nada.**
**Filtro dinero dueño:** ingresos/egresos filtrados por `_ckEsDueno(m)` (`m.cuenta ∈ _cuentasDuenoNombres`, 11413); egresos además excluyen `_ckEsRetiroSocio` (flag `esRetiroSocio` o heurística cierre+concepto=nombre socio, 11420).

### Selector de período (calendario) — banner top-right
- `_ckCalAbrir()` abre `#ck-cal-panel` (calendario propio, reemplaza dropdown de mes). Navegación `_ckCalNav(±1)`. Botones rápidos: `_ckCalMesCompleto()`, `_ckCalPorCierre()`, `_ckCalAntesCierre()`. Pinta cierres + rango elegido.
- Motor: `filterCkByRango(desde,hasta)` (11473) setea `window._ckRango={desde,hasta}` y re-renderiza TODO (KPIs, charts, funnel, socios). Filtra por `m.fecha` (`>=desde && <=hasta`, YYYY-MM-DD lexicográfico). `hasta` nunca pasa de hoy (`fechaHoyARG`).
- `_ckRangoDefault()` (11450): rango del **último cierre cerrado** (por `cerradoEn`): `desde=fechaInicio`, `hasta=fechaFin`; sin cierres → mes actual completo (recortado a hoy).
- `filterCkByMes(mes)` wrapper legacy → convierte mes→rango. Label activo en `#ck-ing-sub` (`desde → hasta`).
- Aviso `#ck-cierre-cruce`: si el rango incluye un cierre que arranca antes del `desde` (cruza meses) → warning "parte de los ingresos quedan fuera del rango" (ganancia falsamente baja).

### Banner KPIs — `renderCkKpis(ingresos, egresos, presupuestos, mcClientes)` (20914)
- `ck-ing` Ingresos (Σ monto filtrado) · `ck-eg` Egresos · `ck-gan` Ganancia neta (ing−eg) + `ck-margen-sub`/`ck-margen-barra` (margen = gan/ing %).
- `ck-clientes-nuevos` "Ventas del período" = nº ventas reales (`_clientVentas` mostrador+CC por rango `v.fecha`) · `ck-tick` Ticket promedio (montoVentas/nVentas) · `ck-cobros-pend` "Por cobrar" = Σ saldos de presupuestos `Aprobado` neteados (`_presupSaldo` = monto − `cobradoPorPresup`), `ck-cobros-pend-sub` nº con saldo.
- Ventas (mostrador) son fuente separada: NO afectan ing/eg/ganancia (esos son owner-only sin mostrador).

### Resumen del período — `renderCkResumen` (21041) · `#ck-resumen-card`
- Líneas auto: nivel de margen (≥70 excelente / ≥40 esperado / <40 revisar costos); mayor egreso (concepto+monto); Σ presupuestos aprobados sin cobrar; ticket promedio. Card visible solo si hay líneas.

### Alertas automáticas — `renderCkAlertas` (21067) · `#ck-alertas-grid`
- `$X sin cobrar` (presups Aprobados con saldo); margen excelente (≥70) o bajo (<40); "pocas transacciones" (<3 ingresos). Tipos warn/danger/ok.

### Funnel de presupuestos — `renderCkFunnel(presupuestos)` (20871) · `#ck-funnel`
- Cuenta Enviados / Aprobados / Cobrados (por `p.estado`); "sin cobrar" = Σ `_presupSaldo` de Aprobados; barra % conversión = (aprob+cobr)/(env+aprob+cobr). Lee `_clientPresupuestos`.

### Ranking de clientes — `renderCkRankingClientes(ingresos)` (20982) · `#ck-ranking-clientes`
- Histórico (todos los períodos). Preferente: `_mcClientes` con `totalCobrado>0` (top 6, % del total). Fallback: agrupa `_clientIngresos` crudos (sin filtro dueño) por `i.cliente||i.concepto`.

### Distribución a socios — `renderCkDistribucionSocios()` (21093) · `#ck-dist-b1` (izq) + `#ck-dist-b2` (cierres full-width)
- Lee `_clientCierres`, items `distribucion[].tipo==='participante'`. Selector de **año propio** (chips, `setDistAnio`) + filtro por socio (`setDistSocio` por índice, `_distSociosAll`). NO usa el calendario de arriba.
- Total distribuido del año, evolutivo mensual (SVG barras solo meses pasados), detalle por socio×mes, timeline de cierres (`abrirModalCierreAnterior`, "Ver detalle"). Tooltip barras `ckDistTip`.

### Reserva del negocio — `renderCkReservaNegocio()` (21233) · `#ck-dist-reserva` (comparte `_distAnio`)
- Saldo actual = `window._reservaTotal` (de `preloadCajaSaldo`). Aportes = items cierre `tipo==='reserva'` del año. Usado = aportado − saldo (sin leer libroCaja). Card saldo + 3 métricas (Aportado/Usado/Saldo hoy) + gráfico evolución + tabla por mes (uso imputado al último mes).

### Charts + Egresos
- `ckChart` evolución anual, `ckMesChart` mes/rango. `ckEgAnualChart`/`ckEgMesChart` egresos por concepto o proveedor (`setCkEgVista('concepto'|'proveedor')`).
- **Embi:** `embiAnalizarIndicadores()` botón "Ver análisis" → manda "Analizá mis indicadores" al chat Embi (no persiste indicadores).

---

## Gestión — Plan de acción
**Vista:** `ct-tareas` (~3753, título "Plan acción") · `loadClientTareas()` (21389). Al abrir (`showCTab('tareas')`) además `loadListas()`. Carga inicial también en boot (8029-8030). Tab índice 3 del subnav-herramientas.
**Escribe/lee** (todo `clientes/{currentClientUID}/...`): `tareas`, `ideas`, `listas`, `sesiones` (tracking productividad).

### Session tracking (auto) — `paTrackModEntry/Exit`
- Wrappea `showClientMod`: al salir de un módulo tras ≥10s escribe `sesiones` `{modulo, entrada, salida, duracion(min≥1)}`. Alimenta "Mi productividad".

### Mi productividad — `paLoadProductividad`/`paRenderProductividad` (21777/21792)
- Lee `sesiones`. Toggle `paProdSetPeriod('semana'|'hoy'|'mes')`. Barras de minutos por módulo (Inicio…Gestión), insight del módulo más activo. Solo render, no escribe.

### Tablero Kanban "Mis tareas" — `renderClientTareas(tareas)` (21502)
- Lee `tareas` (no `eliminado`). Cache `_paTareas`/`window._clientTareas`. 3 columnas por `estado`: `pend`/`doing`/`done` (`#clt-tasks-pend|doing|done`), counts `pa-kpi-pend/curso/comp`. Card `paBuildCard` (21454): dot por `prioridad` (Alta `#b09088`/Media/Baja), tags "Vence hoy"/"Venció d/m"/"Completada" según `fechaVenc` vs hoy.
- **Crear:** `paOpenNuevaTarea()` → modal `newClientTaskModal`. `createClientTask()` (21555) lee `#clt-titulo`(req)/`clt-meta`/`clt-estado`/`clt-prioridad`/`clt-fecha-venc` → `addDoc(tareas, {titulo, meta, estado, prioridad, creadoEn, fechaVenc?})`. Actualiza counts, calendario, pomodoro, nota venc.
- **Mover estado:** click card `moveClientTask(el)` (21588) → cicla pend→doing→done→pend, `updateDoc {estado}`. Confetti al pasar a `done`.
- **Completar:** = mover a `done` (mismo flujo).
- **Eliminar:** botón basura `deleteClientTask(el)` (21609) → `showConfirm` → `updateDoc {eliminado:true, eliminadoEn}` (soft).
- **Drag & drop:** `paDragStart`/`paInitDrop` → soltar en columna → `updateDoc {estado:targetCol}` (22110).
- Campos tarea: `titulo`, `meta`, `estado`(pend/doing/done), `prioridad`(Alta/Media/Baja), `fechaVenc`(YYYY-MM-DD opt), `creadoEn`, `eliminado`, `eliminadoEn`.

### Nota vencimiento + Calendario — `paRenderNotaVencimiento` (21627) / `paRenderCalendario` (21646)
- Nota `#pa-venc-nota`: tarea no-done que vence hoy/mañana. Calendario semana + "Próximas tareas" (top 3 futuras por `fechaVenc`). Solo lectura de `_paTareas`.

### Pomodoro — `paPomoToggle`/`paPomoSkip` (21733/21757)
- Timer 25/5 min, rondas en `localStorage` (`pa_pomo_rounds`). Muestra primera tarea `pend` como foco. **No persiste en Firestore.**

### Mis ideas — `paLoadIdeas`/`paRenderIdeas` (21867/21876) · colección `ideas`
- `paGuardarIdea()` input `#pa-ideas-input`/Enter → `addDoc(ideas, {texto, creadoEn})`. `paEliminarIdea(id)` → `deleteDoc` (hard delete, distinto de tareas/listas que son soft). Orden `creadoEn desc`.

### Mis listas — `loadListas`/`renderListas` (21922/21932) · colección `listas`
- Lee `listas` orden `orden asc`. Cache `_listas`. Card `buildListaCard` con barra progreso (completados/total).
- **Crear lista:** `crearLista()` → modal `#modal-nueva-lista`. `confirmarCrearLista()` (22006) → `addDoc(listas, {nombre, color(rota gold/silver/rose/sage/blue), items:[], creadoEn, orden})`.
- **Agregar ítem:** `agregarItemLista(listaId, texto)` (22018) → push `{id(Date.now b36), texto, completado:false}` a `items`, `updateDoc {items}`.
- **Toggle ítem (completar):** `toggleItemLista(listaId, itemId)` (22032) → invierte `completado`, `updateDoc {items}`.
- **Eliminar lista:** `eliminarLista(listaId)` (22042) → `showConfirm` → `updateDoc {eliminado:true}` (soft; el filtro de carga NO excluye `eliminado`, solo se saca del cache local).
- Campos lista: `nombre`, `color`, `items[]{id,texto,completado}`, `creadoEn`, `orden`, `eliminado`.

**Nota:** existe colección legacy `tareas` a nivel raíz (admin, funcs ~9398-9462) y colección `kpis` (`saveClientKpis`, 10729) separadas — no son parte de estos módulos cliente.


---


# 10 · Mi cuenta · Equipo · Roles y planes

SPA `index.html` (multi-tenant `clientes/{clienteId}/…`). Doc de solo-lectura.
Estructura: `ct-membresia` (~5241, card legacy estática), `ct-micuenta` (~5262, página real), `ct-equipo` (~5486).

---

## Mi cuenta
**Vista:** `ct-micuenta` (línea 5262) · loader `loadMiCuentaPage()` (línea 25920)
**Acceso:** solo `admin`/dueño. `navigateToMiCuenta()` (25799) hace `if(window.currentRol!=='admin') return`. Botones sidebar `sb-mi-cuenta-btn` / `mobile-mi-cuenta-btn` ocultos a no-admin por `_aplicarRestriccionesRol`.
Es una **página única scrolleable** (banner + Perfil del negocio + Datos fiscales + Membresía + Seguridad), no sub-tabs reales.
`loadMiCuentaPage` lee `getDoc(clientes/{uid})` y puebla inputs; banner con avatar (inicial de `negocioNombre`), email (`currentUser.email`), KPIs: Miembro desde (`creadoEn`/`activoDesde`), Plan activo (`membresia.plan` → `_planLabel`), Próximo cobro (`membresia.proximoCobro`).

### Datos del negocio (Perfil del negocio)
Guarda con `guardarMiCuentaPage()` (26039) → `updateDoc(clientes/{uid}, …)`:
- `micuenta-titular-nombre` → escribe `titularNombre`
- `micuenta-negocio-nombre` → escribe `negocioNombre` (refleja en `negocio-nombre-display`, `inicio-negocio-nombre`)
- `micuenta-negocio-rubro` → `negocioRubro`
- `micuenta-negocio-tel` → `negocioTel`
- `micuenta-negocio-email` → `negocioEmail`
- `micuenta-negocio-dir` → `negocioDir`
- Logo → `uploadMicuentaLogo(input)` (26014): máx 200KB, base64 → escribe `logoNegocio`; refleja en `negocio-logo-wrap`/`inicio-logo-wrap`; refresca `renderOnboardingChecklist`.
- feedback: `micuenta-saved` (2s) + `showToast`

### Datos fiscales
Guarda con `guardarDatosFiscalesPage()` (26123) → `updateDoc(clientes/{uid}, …)`:
- `micuenta-negocio-cuit` → `negocioCuit`
- Condición IVA → `selectMiCuentaCondicionIVA(val)` (26069) escribe hidden `micuenta-negocio-condicion-iva` → `negocioCondicionIVA` (`monotributista`/`responsable_inscripto`/`exento`, pills)
- `micuenta-punto-venta` → `negocioPuntoVenta`
- Domicilio fiscal: checkbox `micuenta-fiscal-mismo` → `negocioDomicilioFiscalIgual`; `toggleMiCuentaFiscalMismo()` (26087) deshabilita campos si "igual al comercial". Campos: `negocioFiscalCalle/Localidad/Provincia/Cp`.
- Comprobante PV (PDF ≤2MB): `handleMiCuentaPvUpload` (26108) → `window._pvComprobanteBase64` → escribe `negocioPvComprobante`
- **Efectos al guardar** con CUIT+PV presentes: escribe alerta `setDoc(clientes/{uid}/alertas/solicitud-fiscal)` (info) + fire-and-forget `POST /.netlify/functions/verificar-delegacion` (con idToken, `{negocioCuit, negocioPuntoVenta}`).
- **Tracker de activación** (en `loadMiCuentaPage`, `micuenta-afip-status`): 4 pasos con estado `_ts`:
  - `_ts=1` sin CUIT o sin PV (⚠️ completar)
  - `_ts=2` datos cargados, verificando (🕐 24-48hs)
  - `_ts=3` verificación MB Strategy
  - `_ts=4` `afipAprobado===true` (✅ listo para facturar)
- **Aprobación/revocación ARCA = lado ADMIN, no el cliente.** `setAfipAprobado(value)` (8868) usa `currentClientId` (cliente en back-office), botones `det-fiscal-aprobar-btn`/`det-fiscal-revocar-btn` (HTML 2577-2578) → `updateDoc(clientes/{clientId},{afipAprobado:value})` + alerta success. Panel admin `openClientDetail` (8885) muestra `det-fiscal-*` (cuit/pv/condicion/estado). El cliente NUNCA se auto-aprueba; `afipAprobado` arranca `false` (9355).

### Membresía (card dentro de ct-micuenta)
Loader `loadMembresiaSection()` (25557): lee `clientes/{uid}.membresia` + `config/planes` (fallback a precios hardcodeados si no legible). Estados (`membresia.estado`): `activo` | `trial` | `cancelado_pendiente` | `pendiente` | `sin-plan`.
- Muestra bloque `memb-activo` (activo/trial/cancelado_pendiente), `memb-pendiente` o `memb-sin-plan`.
- Plan actual → `memb-plan-nombre` (`_planLabel`), próximo cobro → `memb-proximo-cobro`, monto → `memb-monto` (de `config/planes[plan].precioPesos`), badge `memb-estado-badge`.
- Cards de planes: `_renderPlanCards(cont, planes, planActual, modo)` — modo `cambiar`/`suscribir`/`info`. Card actual = "Tu plan" (deshabilitada).
- **Acciones:**
  - `suscribirseMP(plan)` (25638) → `POST /.netlify/functions/mp-subscription {clienteId, plan}`; escribe `membresia.initPoint`; redirige a MP.
  - `cambiarPlan(nuevoPlan)` (25784) → confirm → `updateDoc(membresia.estado='cancelado', membresia.canceladoEn)` + `suscribirseMP(nuevoPlan)`.
  - `actualizarTarjeta()` (25670) → mismo endpoint mp-subscription, redirige a MP.
  - `cancelarMembresia()` (25742) → confirm → `POST /.netlify/functions/mp-cancel {clienteId}`; queda `cancelado_pendiente` con acceso hasta `proximoCobro`.
  - `reactivarSuscripcion()` (25712) → solo en cancelado; nuevo preapproval, cobro inmediato (trial ya usado).
  - `continuarPago()` (25662) → redirige a `membresia.initPoint` guardado.
- Banners globales: `_mostrarBannerPagoFallido(dias)`, `_mostrarBannerCancelada(fecha)`.
- (`ct-membresia` en 5241 = card estática legacy "post-programa $40 USD", no es la sección viva.)

### Seguridad
`cambiarPasswordPage()` (26193): campos `micuenta-pass-actual`/`-nueva`/`-confirm`. Valida nueva ≥6 y coincidencia; reautentica con `EmailAuthProvider.credential(email, actual)` + `reauthenticateWithCredential` → `updatePassword(currentUser, nueva)` (Firebase Auth). Errores: `auth/wrong-password`/`auth/invalid-credential` → "Contraseña actual incorrecta". Feedback `micuenta-pass-saved`.
(Relacionado: `confirmarPrimerLogin()` (26167) fuerza cambio en primer login, ≥8 chars, escribe `primerLogin:false`.)

---

## Equipo
**Vista:** `ct-equipo` (línea 5486) · loader `loadEquipoModule()` (31542)
**Acceso:** solo `admin`. Botón sidebar `sb-equipo-btn` visible solo admin (`_aplicarRestriccionesRol` 33548-33552).
Banner muestra `negocioId` (`equipo-negocio-id-display`), KPIs Total (`equipo-kpi-total`) y Activos (`equipo-kpi-activos`).
Dos tabs: **Usuarios** / **Cajas** → `equipoTabSwitch(tab)` (31642).
Botón `+` dinámico: "Nuevo usuario" (usuarios) / "Nueva caja" (cajas).

### Usuarios (operadores)
Loader lee `getDocs(clientes/{uid}/operadores)` → `window._equipoOperadores`; precarga `clientes/{uid}/cajas` → `window._equipoCajas`.
Tabla: Nombre, Usuario, Rol (badges), Estado (Activo/Inactivo `activo!==false`), Acciones.
- Rol: multi-rol `roles[]` (fallback string `rol`). `ROL_LABEL={cajero,compras,comercial,admin,produccion,stock}` (31591).
- Si incluye `cajero`: muestra cajas asignadas (`o.cajas[]` → nombres de `_equipoCajas`) o "Todas las cajas" si vacío.
- Empty state con onboarding 01/02/03 + "Crear primer usuario".

**Modal Nuevo/Editar usuario** (`equipo-modal-overlay`, HTML 5527):
- Campos: `equipo-nombre`, `equipo-usuario` (sin espacios/@, `equipoUsuarioValidar`), `equipo-password` (≥6).
- Rol = pills multi-selección `.equipo-rol-pill` (`equipoRolSeleccionar` 31925, toggle individual): cajero/compras/comercial/produccion/stock (NO admin — admin es el dueño). Default `cajero`. Hidden `equipo-rol` = primer rol activo (legacy).
- Si tiene `cajero`: aparece `equipo-cajas-block` con checkboxes de cajas (`equipoCajasRenderCheckboxes` 31968). 1 caja → locked/auto-seleccionada. Obligatorio ≥1 (`equipoCajasValidar` 32035).
- Show: `equipoNuevoUsuarioShow()` (31816, modo crear) / `equipoEditarUsuario(uid)` (31853, modo editar — usuario readonly, password vacío = no cambia; carga `roles[]` y cajas guardadas o legacy=todas activas).
- Guardar: `equipoNuevoUsuarioGuardar()` (32045) → `POST /.netlify/functions/create-operator` con idToken + header `X-Cliente-UID`:
  - crear: `{accion:'crear', nombre, usuario, password, roles, clienteUID, cajas?}`
  - editar: `{accion:'editar', uid, nombre, roles, clienteUID, password?, cajas?}`
  - La function crea/edita el doc en `clientes/{uid}/operadores` (campos: `nombre`, `usuario`, `password`/hash, `roles[]`, `uid`, `cajas[]`, `activo`) + usuario Firebase Auth.
- **Desactivar:** `equipoDesactivar(docId,usuario,uid,btn)` (32112) → confirm → `create-operator {accion:'desactivar', docId, usuario, uid}` (no puede loguear, conserva historial).
- **Eliminar:** `equipoEliminar(docId,usuario,uid,btn)` (32136) → confirm → `create-operator {accion:'eliminar', …}` (permanente).

### Cajas
**Gating:** tab Cajas requiere plan `gestionCajas` (**Pro**). Si no: `equipoTabSwitch('cajas')` oculta botón + `_proLockEnTab('equipo-contenido','Gestión de cajas',true,'pro')` (31659).
Loader `equipoLoadCajas()` (31677): `getDocs(clientes/{uid}/cajas)` → `_equipoCajas`.
- **Auto-crea "Caja mostrador"** si no hay ninguna: `addDoc(cajas, {nombre:'Caja mostrador', activa:true, esCajaMostrador:true, creadoEn})`. (Nombre load-bearing.)
- Tabla: Nombre (+"(principal)" si `esCajaMostrador`), Estado (Activa/Inactiva `activa!==false`), Acciones (Editar / Desactivar — mostrador no se desactiva).

**Crear/editar caja adicional = plan `multicaja` (Premium):**
- `_chequeoCajaCajero()` (31732) → `{ok: tieneAccesoPlan('multicaja'), plan:'premium'}`. Si no ok → `_proToast`.
- `equipoCajaShow()` (31735) abre modal `equipo-caja-modal-overlay` (HTML 5570) SOLO si Premium.
- `equipoCajaGuardar()` (31757): campo `equipo-caja-nombre` → crea `addDoc(cajas,{nombre,activa:true,esCajaMostrador:false,creadoEn})` (re-chequea Premium) o edita nombre (`equipoCajaEditar` 31788, sin re-gate).
- `equipoCajaDesactivar(id)` (31805) → `updateDoc(cajas/{id},{activa:false})`.
- **Asignación cajero↔caja** vive en el operador (`operadores.cajas[]`), no en la caja. Se elige en el modal de usuario.

**Login del cajero (selección de caja):** `cajeroResolveCajas(operador)` (7422) resuelve cajas activas asignadas; `cajeroSelectorCajaMostrar` (7437) muestra selector si >1; `cajeroSelectorCajaElegir(id,nombre)` (7461) fija `_cajaActivaId`/`_cajaActivaNombre` y abre apertura de caja.

---

## Roles y planes (referencia central)
Definidos ~33367-33580.

### Planes (`window.PLAN_FEATURES`, 33392) — single source of truth por plan
| flag | esencial | pro | premium |
|---|---|---|---|
| `modulos` | inicio, finanzas, ventas, compras, herramientas, gestion | + `stock` | + `stock`, `produccion` |
| `embi` | `explicativo` | `operativo` | `operativo` |
| `auditoriaCajero` | false | true | true |
| `stock` | false | true | true |
| `produccion` | false | false | true |
| `cierrePeriodo` | true | true | true |
| `analisisEmbi` | false | true | true |
| `maxUsuarios` | 1 | ∞ | ∞ |
| `gestionCajas` | false | true | true |
| `multicaja` | false | false | true |

Helpers:
- `normalizarPlan(v)` (33405): `base`/`esencial`→`esencial`, `pro`→`pro`, `premium`→`premium`; default/desconocido/`business`/vacío → `esencial` (menor privilegio).
- `_planActual(cd)` (33414) → normaliza `(cd||currentClientData).plan`.
- `_planLabel(plan)` (33419) → `Esencial`/`Pro`/`Premium`.
- `tieneAccesoPlan(feature, cd)` (33424) → valor de `PLAN_FEATURES[plan][feature]`.
- `tieneAccesoAModulo(mod)` (33429) / `tieneAccesoATab(tab)` (33441): admin/sin-rol → true; usa `_operadorRoles` (excluye `cajero`); true si algún rol lista el módulo/tab (o lista null).

### Roles — `_MOD_POR_ROL` (33367) y `_TAB_POR_ROL` (33377)
Admin ve todo (`null` = sin filtro). Cajero NO está en estos maps (circuito aparte). "admin" = dueño; no asignable como operador.

| rol | módulos (`_MOD_POR_ROL`) | tabs (`_TAB_POR_ROL`) |
|---|---|---|
| **admin** | null (todos) | null (todos) |
| **comercial** | `ventas` | mclientes, cobranzas, presupuestos, productos, catalogo |
| **compras** | `compras` | proveedores, necesidades, ordenes-compra, historial-compra, prod-compra, categorias-compra |
| **vendedor** | `ventas`, `finanzas` | mclientes, cobranzas, presupuestos, productos, catalogo, **caja** |
| **produccion** | `produccion` | produccion |
| **stock** | `stock` | insumos, recetas, movimientos-stock |
| **cajero** | (aparte) circuito caja | Finanzas › caja + mis-facturas (+ botones retiro/cierre) |

> Nota: `vendedor` NO aparece en las pills del modal Equipo (5545-5549 ofrece cajero/compras/comercial/produccion/stock). `vendedor` existe en los maps (asignación legacy/otra vía). `compras` NO incluye módulo/tabs de stock (comentario 33376: quien necesite stock → rol `stock` aparte).

### `_ocultaMap` — qué OCULTA cada rol (`_aplicarRestriccionesRol` 33491, ids de sidebar-group `sbg-*`)
- **cajero:** oculta inicio, compras, stock, produccion, herramientas, gestion, `btn-mi-cuenta`, `mc-kpi-clientes-grid` (deja finanzas/ventas parciales; muestra botones cajero retiro/cierre; en Finanzas solo sub-items `caja` y `mis-facturas`).
- **compras:** oculta inicio, finanzas, ventas, stock, produccion, herramientas, gestion.
- **comercial:** oculta inicio, finanzas, compras, stock, produccion, herramientas, gestion.
- **vendedor:** oculta inicio, compras, stock, produccion, herramientas, gestion.
- **produccion:** oculta inicio, finanzas, ventas, compras, stock, herramientas, gestion, `btn-mi-cuenta`.
- **stock:** oculta inicio, finanzas, ventas, compras, produccion, herramientas, gestion, `btn-mi-cuenta`.
- Solo `admin` ve: Inicio, `sb-equipo-btn`, `sb-mi-cuenta-btn`/`mobile-mi-cuenta-btn` (33547-33564).
- Función idempotente: primero resetea visibilidad (33499-33510) y luego oculta según rol. Añade/quita clases body `es-{rol}`.

### Operador mixto cajero + sistema
Un operador con `roles[]` que incluye `cajero` **y** al menos un rol de sistema:
- **Login** (7895-7923): expone `_operadorRoles`. Si `_hasCajero && _hasSistema` → `modoOperadorElegir(_op)` (33455) muestra overlay `modoOperadorOverlay` para elegir Modo Caja / Modo Sistema (cards `modoOperadorElegirSet('caja'|'sistema')` 33471, HTML 36029/36040). Si solo cajero → `caja`; si solo sistema → `sistema`.
- `window._modoActivo` guarda el modo. `currentRol` = `'cajero'` (modo caja) o el primer rol ≠cajero (modo sistema).
- **Modo forzado:** botón "Cambiar modo" `cambiarModoOperador()` (33484) escribe `sessionStorage.mb_modo_forzado` (modo opuesto) y `location.reload()`; el login lo detecta (7908-7911), lo usa sin re-preguntar y lo borra. Cierre+login normal vuelve a preguntar.
- Botón sidebar `sb-cambiar-modo-btn` visible solo si mixto (33567-33580); label `sb-cambiar-modo-label` = "Ir a Sistema"/"Ir a Caja" según `_modoActivo`.
- En modo sistema con varios roles: `_aplicarRestriccionesRol` calcula la **intersección** de las listas `_ocultar` (oculta un id solo si TODOS los roles lo ocultan → unión de accesos) (33527-33541).

### Panel admin legacy (back-office)
`loadAdminUsuarios()` (32162) + `ROL_LABEL` propio (32183, `compras:'Compras + Stock'`) — vista de operadores del lado MB Strategy, distinta de `ct-equipo` del cliente.


---


# Circuito Cajero (rol `cajero`)

**Acceso:** modo caja separado del backoffice. `showCTab` restringe tabs a `['caja','contabilidad','mclientes','cobranzas','mis-facturas']` (~31394; si `tab` no está en la lista → `return`). Nav de módulos restringida a `['finanzas','comercial','ventas']`. `_aplicarRestriccionesRol` (~33491) oculta grupos `sbg-*` salvo Finanzas/Ventas y muestra los botones cajero. Vista de caja propia = **turno** (apertura/cierre), NO el libro de caja del dueño. Cuenta base load-bearing: **`Caja mostrador`** (todos los medios del cajero se escriben con `cuenta:'Caja mostrador'`; `medioPago` distingue el medio real). `body.cajero-mode` activo.

**Estado global:** `window.currentRol='cajero'`, `window.turnoActual` (doc de `turnos` o `null`), `window._cajaActivaId` / `window._cajaActivaNombre` (caja elegida), `window.currentOperadorNombre` / `window.currentOperadorId`, `window._cajaMovimientos` (movs del turno), `window._modoActivo` (`'caja'`/`'sistema'` para operadores mixtos).

### Colecciones / campos
- **`clientes/{id}/turnos`** — `cajeroUid`, `cajeroNombre`, `estado`(`'abierto'`/`'cerrado'`), `cajaId`, `cajaNombre`, `apertura:{monto,fecha,creadoEn}`, `cierre:{monto,fecha,creadoEn}` (`null` mientras abierto), `creadoEn`.
- **`clientes/{id}/libroCaja`** — movimientos. Campos: `tipo`(`ingreso`/`egreso`/`pedido_cta`/`transfer`), `cuenta`, `medioPago`, `monto`, `concepto`, `detalle`, `fecha`, `mes`, `uid`, `eliminado`, `origen`, `turnoId`, `creadoPor`, `creadoEn`, `ticketNum`, `productos[]`, `observacion`, `estado`, `facturado`/`facturaId`, `devuelto`, `refMovId`, `cajaOrigenId`/`cajaOrigenNombre`, `modificaciones[]`. `origen` del cajero: `apertura_turno`, `venta_caja`, `venta_caja_espejo`, `caja_cajero`(pedido a cuenta), `deposito_cajero`, `egreso_cajero`, `retiro_cajero`, `retiro_cajero_cierre`, `devolucion_caja`, `devolucion_caja_espejo`, `cierre_turno`.
- **`clientes/{id}/cajas`** — `nombre`, `activa`, `esCajaMostrador`, (asignación por operador vía `equipoGetCajasOperador`).
- **`clientes/{id}/cuentas`** — `nombre`, `tipo`(`efectivo`/`banco`/`mp`/`retiros`/`reserva`), `orden`, `esReserva`, `eliminado`. `Caja mostrador` = cuenta base.
- **`clientes/{id}/cobros`** — pedidos a cuenta: `clienteId`, `clienteNombre`, `concepto`, `ticketNum`, `productos`, `monto`, `estado`(`pendiente`/`cobrado`), `fecha`, `origen:'caja_cajero'`, `libroCajaId`, `creadoPor`.
- **`clientes/{id}/facturas`** — comprobantes AFIP emitidos desde caja (`movId` enlaza al `libroCaja`).
- **`clientes/{id}/misClientes`** — clientes del negocio (vista acotada del cajero).

### Login cajero → selección de caja → apertura
- **Login** (~7900): resuelve roles del operador. Si mixto (cajero + rol sistema) → `modoOperadorElegir` pregunta modo; solo cajero → `_modoActivo='caja'`. Setea `currentRol='cajero'`, `currentOperadorNombre/Id`, `turnoActual=null`.
- **Recuperación de turno abierto** (~7927): query `turnos where cajeroUid==uid && estado=='abierto'`. Si existe → `turnoActual={id,...}` y restaura `_cajaActivaId`/`_cajaActivaNombre` desde el doc (recovery post-reload).
- **Sin turno abierto** (~7940): `cajeroResolveCajas(op)` (~7422) lee `cajas` y filtra las asignadas/activas.
  - 0 cajas → `sessionStorage mb_login_err` + `signOut` + reload.
  - 1 caja → set `_cajaActivaId/Nombre` directo → `cajaAperturaShow()`.
  - >1 caja (**multicaja**) → oculta `#app`, muestra `cajeroSelectorCajaMostrar(op, cajas)` (~7437; cards, `esCajaMostrador` → eyebrow "PRINCIPAL", ordena mostrador primero).
- **`cajeroSelectorCajaElegir(id, nombre)`** (~7461) → set `_cajaActivaId/Nombre` · muestra `#app` · `cajaAperturaShow()`.
- Módulo inicial del cajero = `'finanzas'` (~7989). `_isMultiCajaPending` = cajero sin turno y sin caja → mantiene `#app` oculto hasta elegir.

### Apertura de turno (`cajero-apertura-overlay` · `cajaAperturaConfirmar`)
- **`cajaAperturaShow`** (~33152): calcula saldo en sistema de `Caja mostrador`. Lee `libroCaja` completo · toma última `apertura_turno` de la caja activa como base · suma ingresos/egresos de efectivo posteriores (excluye MP/Transferencia; `medioPago 'Caja mostrador'` = saneo histórico) y `transfer` desde/hacia. Escribe `#cajero-apertura-saldo-sistema`.
  - `_esPrimerTurno` (sin apertura previa) → input `#cajero-apertura-monto` editable, msg "Ingresá el efectivo inicial". Si NO primer turno → input `readOnly`, valor = saldo fijado por cierre anterior ("Monto fijado por el cierre del turno anterior").
  - **Warning coexistencia** (~33216): query `turnos where estado=='abierto'`; si hay turno de OTRO `cajeroUid` → banner "Hay un turno abierto · {nombre} tiene un turno activo. Podés abrir el tuyo igualmente — compartirán la misma caja" en `#cajero-apertura-warning`.
  - Botón `Cerrar sesión` → `doLogout()`.
- **`cajaAperturaConfirmar`** (~33249) [Iniciar turno]: parsea monto declarado (`replace(/[^\d]/g)`).
  - **Escribe `turnos`** (`_addDoc`): `{cajeroUid:currentOperadorId, cajeroNombre, estado:'abierto', cajaId:_cajaActivaId, cajaNombre, apertura:{monto,fecha,creadoEn}, cierre:null, creadoEn}` → set `turnoActual`.
  - Si `monto>0` → **escribe `libroCaja`**: `{tipo:'ingreso', concepto:'Apertura de turno', cuenta:_cajaActivaNombre, medioPago:'Efectivo', monto, origen:'apertura_turno', turnoId implícito por caja}`.
  - Cierra overlay · toast "Turno iniciado" · `loadCajaModule()`.

### Vista Caja del cajero (`renderCajaCajero` ~11812)
- Gate: `loadCajaModule` (~12684) — si cajero sin `turnoActual` → `cajaAperturaShow()` y `return` (no hay vista sin turno). Filtra `libroCaja` a la caja activa + turno (excluye `*_espejo`), filtra por `apertura.creadoEn`, guarda en `_cajaMovimientos`, llama `renderCajaCajero`. Suscribe `onSnapshot` de `cobros` pendientes (badge "A cobrar").
- **KPIs / cards de medios** (`.cv-top-row2`): por medio (`Efectivo`, `Transferencia`, `Mercado Pago`, `Tarjeta`) suma ingresos − egresos del turno. `Efectivo` = `calcularEfectivoTurno(movs, aperturaMonto)` (~11799: solo movimientos con medio real Efectivo; excluye `apertura_turno`, `pedido_cta`, MP/Transf/Tarjeta). Card **"A cobrar (n)"** = `_cvPendiente` (cobros pendientes) → click `sidebarNav('ventas','cobranzas')`. Card **"Saldo del turno"** = `aperturaMonto + totalIng − totalEg` (con animación `cv-bump` al cambiar).
- **Tabla movimientos** (`.cv-movimientos`): cada mov ordenado desc por `creadoEn`. Pill de medio, tipo (`Venta`/`Retiro`/`Egreso`/`Pendiente`/`Cobrado`), monto con signo, botón Facturar/✓Factura emitida (solo `ingreso` no-apertura). Click fila → `cajaMovDetalle(id)`. Mov nuevo → clase `cv-nueva`.
- **Barra inferior** (`.cv-bottom-bar`): `Nueva venta`→`cajaVentaRapida()` · `Retiro`→`cajaRetiroShow()` · `Depósito`→`cajaDepositoShow()` (cajero; dueño ve `+ Movimiento`) · `Cerrar caja`→`cajaCierreShow()`. Hamburguesa `cv-hamburger` abre sidebar acotado.
- Botones duplicados en subnav-finanzas (`btn-cajero-retiro`/`btn-cajero-cierre`, ~2606) y banner (`btn-cajero-retiro-banner`/`btn-cajero-cierre-banner`, ~3044), mostrados por `_aplicarRestriccionesRol`.

### Nueva venta (`vrc-overlay` · `cajaVentaRapida` ~17462 · `vrcGuardar` ~17997)
- **`cajaVentaRapida`**: carga `productos` + `cuentas`. Para cajero filtra `_vrcCuentas`: excluye `retiros`/`reserva`, excluye efectivo que no sea `Caja mostrador`; relabela `Caja mostrador → 'Efectivo'` y la pone primera. Calcula 3 más vendidos (por conteo en `_cajaMovimientos`). Métodos: cuentas + `__tarjeta__` (Débito/Crédito) + `__cta__` (cuenta cliente).
- **`vrcGuardar`** [Registrar venta]: arma `productos[]` (nombre, qty, precioUnitario, subtotal) y `total`. Obtiene `ticketNum` (`_getNextTicketNum`).
  - **Pedido a cuenta** (`__cta__`): requiere cliente. Escribe `cobros` (`estado:'pendiente'`, `origen:'caja_cajero'`) + `libroCaja` (`tipo:'pedido_cta'`, `cuenta:_cajaActiva`, `estado:'pendiente'`, `clienteId/Nombre`, `turnoId`), enlaza `cobros.libroCajaId`. Imprime ticket + pedido producción. Dispara `_triggerStockPorVenta`.
  - **Venta cobrada**: resuelve `_medioPago` (`Tarjeta Crédito/Débito`, `Transferencia` si banco, `Efectivo`, o nombre de cuenta). `_esCajero = currentRol==='cajero' && _cajaActivaId`. Escribe `libroCaja` primario `{tipo:'ingreso', concepto:'Venta caja', cuenta: (cajero→`Caja mostrador`), medioPago, monto, productos, origen:'venta_caja', turnoId, ticketNum}`.
  - **Doctrina del espejo**: si cajero y medio NO efectivo/tarjeta (MP/Transferencia) → escribe segundo doc `origen:'venta_caja_espejo'` en la cuenta real del dueño (`_cuentaObj.nombre`), con `refMovId`, `cajaOrigenId/Nombre`. Si falta cuenta destino → `showConfirm` "Falta cuenta destino" (no cae en silencio).
  - Imprime ticket cliente + pedido producción (`_mbPrintTicket`/`_mbPrintPedido`). `loadCajaModule()`.

### Facturar (`modalFacturaCaja` · `abrirModalFacturaCaja` ~13328 · `emitirFacturaCaja` ~13394)
- Condición: mov `ingreso` no facturado (botón "Facturar" en fila / `abrirModalFacturaCaja`). Requiere `_verificarDatosFiscales()`.
- Lee el mov de `libroCaja`. Pills de condición IVA del receptor; tipo comprobante calculado por `_getMfcTipoComp(emisorCond, receptorCond)` (RI→A/B, exento→B, monotributo→C).
- **`emitirFacturaCaja`**: POST a `/.netlify/functions/afip` (`accion:'emitirFactura'`, puntoVenta, tipoComprobante, importe, condIVAReceptor, cuit/razón, items). Al ok → `facturas/{id}.movId=movId` y `libroCaja/{movId}.{facturado:true, facturaId}`. Toast CAE · `loadCajaModule()`. Errores AFIP traducidos.

### Depósito (`cajero-deposito-overlay` · `cajaDepositoShow` ~32300 · `cajaDepositoGuardar` ~32313)
- Ingreso de efectivo a la caja. Campos `#cajero-deposito-monto`, `#cajero-deposito-obs`.
- Valida monto>0 y `turnoActual` (si no → "Necesitás abrir un turno primero"). **Escribe `libroCaja`**: `{tipo:'ingreso', cuenta:_cajaActiva, medioPago:'Efectivo', concepto:'Depósito', detalle:obs, origen:'deposito_cajero', turnoId}`. Toast · `loadCajaModule()`. (Excluido del cálculo de medios del cierre por `origen`.)

### Retiro / Egreso con motivo (`cajero-egreso-overlay` · `cajaEgresoShow` ~32344)
- `cajaRetiroShow` (~32417): si cajero → delega a `cajaEgresoShow()`. (El `cajero-retiro-overlay` "Retiro a caja general" es el flujo del motivo "Retiro por cierre".)
- **Step 1** (`cajero-egreso-step1`): 4 motivos → `cajaEgresoSelMotivo(motivo)` (~32366):
  - `Pago a proveedor`, `Compra de insumos`, `Otros` → step 2 (monto + obs), header "Retiro · {motivo}".
  - `Retiro por cierre` (`'__cierre__'`) → cierra egreso, abre `cajero-retiro-overlay` (monto + obs) → `cajaRetiroGuardar`.
- **`cajaEgresoGuardar`** (~32387) [step2 Guardar]: valida monto>0 + turno. **Escribe `libroCaja`**: `{tipo:'egreso', cuenta:_cajaActiva, medioPago:'Efectivo', concepto:_cajaEgresoMotivo, detalle:obs, origen:'egreso_cajero', turnoId}`. Toast · `loadCajaModule()`.
- **`cajaRetiroGuardar`** (~32429) [Retiro por cierre]: valida monto>0 + turno. Escribe **DOS** docs:
  1. Egreso en caja activa: `{tipo:'egreso', cuenta:_cajaActiva, medioPago:'Efectivo', concepto:'Retiro por cierre', origen:'retiro_cajero', turnoId}`.
  2. Ingreso en caja del dueño (SIN `turnoId` → no aparece en el turno): `{tipo:'ingreso', concepto:'Ingreso por retiro de cajero', cuenta:'Efectivo', origen:'retiro_cajero_cierre', cajaOrigenId/Nombre}`.
  Toast · `loadCajaModule()`.

### Detalle de movimiento (`cajero-mov-detalle-overlay` · `cajaMovDetalle` ~32634)
- Muestra tipo/monto/fecha/operador/medio, productos, observación, N° ticket, cliente (si `pedido_cta`).
- **Devolución** (`cmd-devolucion`): solo `ingreso` `origen:'venta_caja'` con productos y no `devuelto`. `cajaMovDevolver`(~32719) elige medio de devolución (de `_vrcCuentas`, excluye `Caja mostrador`) → `cajaMovDevolverConfirmar`(~32759): escribe `libroCaja` egreso `origen:'devolucion_caja'` (efectivo→`Caja mostrador`); si medio no-efectivo → también espejo `devolucion_caja_espejo` en cuenta real; marca mov original `devuelto:true`. Si ya devuelto → botón deshabilitado "✓ Devolución ya realizada".
- **Modificar medio** (`cmd-modificar-medio`): solo `ingreso` `venta_caja`. `cajaMovModificarMedio`(~32818) → `cajaMovModificarMedioConfirmar`(~32853): **batch atómico**. Actualiza `medioPago` + append a `modificaciones[]` (`{campo,de,a,por,creadoEn}`). Reconcilia espejo (`_reconcMedioDestino`): MP→cuenta `mp`, Transferencia→cuenta `banco`; crea/mueve/elimina `venta_caja_espejo` según corresponda. Todo-o-nada: si nuevo medio espeja pero falta cuenta destino → `showConfirm` "Falta cuenta destino", no aplica.
- **Descargar / Ticket** (`cmd-download`): si `ticketNum` → menú `abrirMenuTicketPedido` (~32596): Descargar ticket PDF (`generarTicketPDF` ~32470, jsPDF 80mm térmico, "no tiene validez fiscal"), Reimprimir ticket cliente (`_reimprimirTicketMov`), Reimprimir pedido producción (`_reimprimirPedidoMov`).

### Cobranzas / Clientes (cajero)
- Tabs `cobranzas` y `mclientes` habilitados en `showCTab` y en `sbsub-ventas` (solo `cobranzas`/`clientes` visibles vía `_aplicarRestriccionesRol` ~33598). Card "A cobrar" del render lleva a Cobranzas. `mis-facturas` (`ct-mis-facturas`) también accesible (comprobantes emitidos). Versión acotada: sin resto de sub-items de Ventas ni backoffice.

### Cierre de caja (`cajero-cierre-overlay` · `cajaCierreShow` ~32938 · `cajaCierreConfirmar` ~32969)
- **`cajaCierreShow`** [resumen]: sobre `_cajaMovimientos`:
  - `Ingresos` = suma `ingreso` no-apertura · `Egresos` = suma `egreso` · `Saldo inicial` (`_saldoBase`) = `turnoActual.apertura.monto` · `Saldo final` = base+ing−eg · `Efectivo en caja` = `calcularEfectivoTurno`. Escribe los `#cajero-cierre-*`. Texto "Turno iniciado el {fecha} · {operador}".
- **`cajaCierreConfirmar`** [Cerrar caja]:
  1. Arma resumen enriquecido: productos vendidos (agrupados), medios (excluye apertura y depósitos), pedidos a cuenta pendientes, retiros, egresos de caja, depósitos, modificaciones.
  2. Impresión local `_mbPrintCierre(...)` (comandera, fire-and-forget).
  3. POST `/.netlify/functions/caja-cierre-email` (envía resumen al email del dueño, devuelve `pdfBase64`). Fallback: `turnoGenerarPDF(operador, ing, eg, saldo, movs)` (~33287, jsPDF A4).
  4. **Actualiza `turnos/{id}`** (`_updateDoc`): `{estado:'cerrado', cierre:{monto:saldo, fecha, creadoEn}}`.
  5. **Escribe `libroCaja`**: egreso `{concepto:'Cierre de turno', cuenta:_cajaActiva, medioPago:'Efectivo', monto:saldo, origen:'cierre_turno', turnoId}` → set `turnoActual=null`.
  6. Cajero: `_skipAuthRedirect`, `sessionStorage mb_turno_cerrado='1'`, modal "Caja cerrada" con **Descargar resumen** (PDF base64) + **Cerrar sesión** → `signOut` + `mostrarPantallaEspera()` (~7355, pantalla "Turno cerrado").
  - Errores → toast "Error al cerrar caja".

### Notas load-bearing
- **`Caja mostrador`**: nombre exacto obligatorio; todos los movs del cajero se escriben con `cuenta:'Caja mostrador'` (o `_cajaActivaNombre`), y `medioPago` guarda el medio real. Los cálculos de efectivo/medios tratan `medioPago==='Caja mostrador'` como saneo histórico → Efectivo.
- **`turnoActual` como llave**: sin turno abierto no hay vista de caja (apertura forzada); toda acción valida `turnoActual`; los movs del turno se enlazan por `turnoId` y/o rango `apertura.creadoEn`.
- **Espejo**: MP/Transferencia siempre generan doc `*_espejo` en cuenta real del dueño; efectivo/tarjeta nunca; espejo sin cuenta destino avisa (nunca huérfano).


---
