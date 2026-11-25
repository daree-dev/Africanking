# Modelo de Dominio: Generación Distribuida en Argentina

> Documento de referencia para contributors y código futuro.
> No elige P0–P4. No implementa contratos, APIs ni UI. No propone blockchain como solución.

---

## 0. Advertencia crítica

Un token de BeEnergy **no es** un I-REC, **no es** un certificado ESG, y **no constituye** una declaración de Scope 2.

En Argentina, **IRAM** es el único organismo autorizado para emitir certificados I-TRACK (E) / I-REC, y cada certificado representa 1 MWh de atributos ambientales [IRAM I-TRACK page]. El registro global es operado por Evident.

El **medidor bidireccional instalado por el Distribuidor** es el único instrumento de medición comercial bajo Ley 27.424 [Res. 314/2018, Anexo]. Las lecturas del inversor / SCADA son datos operativos y no tienen efecto comercial en la liquidación del balance neto.

Cualquier afirmación en sentido contrario debe tratarse como deuda conceptual a corregir. **Actualización (Pivot #2, octubre 2026):** `docs/2-HOW-IT-WORKS.md` y `docs/3-DATA-FLOW.md` ya se corrigieron — el vocabulario de "proto-certificado vendible" y "comprador externo" fue reemplazado por "crédito de generación" asignado internamente a los miembros. Sigue siendo cierto que ese crédito **no es** un I-REC ni un certificado ESG — ver §6.

---

## 1. Glosario (ES ↔ EN)

| Término ES | English label | Definición breve |
|---|---|---|
| Usuario-Generador (UG) | User-Generator | Usuario de la red de distribución que genera renovables para autoconsumo e inyecta excedentes [Ley 27.424, Art. 2] |
| Usuario-Generador Individual | Individual User-Generator | Un único usuario con un equipo de generación [Res. 287/2025] |
| Usuario-Generador Comunitario | Community User-Generator | Dos o más usuarios, mismo distribuidor, administración conjunta de un equipo [Res. 287/2025] |
| Usuario-Generador Comunitario Virtual | Virtual Community User-Generator | Como el comunitario, pero con medición en tiempo real que permite balance virtual [Res. 287/2025] |
| Balance Neto de Facturación | Net billing | El valor a pagar es la diferencia entre energía demandada e inyectada, antes de impuestos [Res. 314/2018, Anexo] |
| Medidor bidireccional | Bidirectional meter | Instrumento comercial que mide demanda e inyección por separado [Ley 27.424, Art. 12] |
| Certificado de Crédito Fiscal (CCF) | Fiscal Credit Certificate | Beneficio promocional de $120.000/kW hasta $8.500.000; no transferible [Ley 27.424, Art. 8] |
| I-REC / I-TRACK (E) | International Renewable Energy Certificate | Certificado de 1 MWh de atributos ambientales, emitido por IRAM [IRAM I-TRACK page] |
| Cuotaparte | Share / Quota | Porcentaje de participación de cada usuario en un esquema comunitario [Res. 314/2018, definición incorporada por Res. 608/2023] |
| Distribuidora | Distribution company | Empresa o cooperativa responsable de la red y de la liquidación del balance neto [Ley 27.424, Art. 12] |
| Ente Regulador Jurisdiccional | Provincial regulator | Autoridad provincial que fiscaliza la distribuidora [Ley 27.424, Art. 16] |
| SCADA del inversor | Inverter SCADA | Sistema de monitoreo operativo del inversor, sin efecto comercial |
| Generación bruta | Gross generation | Total generado por el equipo antes de autoconsumo |
| Generación neta | Net surplus | `max(kwh_generated − kwh_self_consumed, 0)` |

---

## 2. Roles y entidades

Para cada entidad se responden tres preguntas:
1. **¿Quién produce el dato?**
2. **¿Quién puede validarlo?**
3. **¿Tiene efecto comercial o es solo operativo?**

---

### 2.1 Usuario-Generador Individual

**Fuente:** Res. 287/2025, Art. 1, Cap. 2(a)(1) [Res. 287/2025].

| Aspecto | Detalle |
|---|---|
| Producción del dato | Usuario / instalador provee datos técnicos (Formulario 2A); el medidor bidireccional produce datos de demanda e inyección |
| Validación | Distribuidora valida la instalación técnica y el medidor; Ente Regulador Jurisdiccional fiscaliza |
| Efecto | **Comercial** — la inyección genera crédito monetario en la factura; el autoconsumo se valoriza a tarifa de demanda |

---

### 2.2 Usuario-Generador Comunitario

**Fuente:** Res. 287/2025, Art. 1, Cap. 2(a)(2) [Res. 287/2025].

| Aspecto | Detalle |
|---|---|
| Producción del dato | Grupo de 2+ usuarios declara porcentaje de participación ante la distribuidora; distribuidora determina factibilidad de conexión. Si el equipo no está vinculado a un punto de suministro, la distribuidora determina la factibilidad del nuevo punto |
| Validación | Distribuidora valida factibilidad y porcentajes; cambios de composición requieren aviso con 30 días de antelación |
| Efecto | **Comercial** — los créditos por inyección se distribuyen según porcentaje declarado |

---

### 2.3 Usuario-Generador Comunitario Virtual

**Fuente:** Res. 287/2025, Art. 1, Cap. 2(a)(3) [Res. 287/2025].

| Aspecto | Detalle |
|---|---|
| Producción del dato | **Medición en tiempo real** de demanda e inyección total del grupo |
| Validación | Distribuidora, sobre medidores con capacidad de telemedición |
| Efecto | **Comercial** — permite distinguir inyección de autoconsumo y valorizar cada componente por separado (autoconsumo, demanda, inyección) |

**Nota del repositorio:** el contrato `energy_distribution` no implementa medición en tiempo real ni distingue las tres valorizaciones que la resolución exige para esta categoría. Ver `docs/5-CONTRACTS.md`.

---

### 2.4 Cooperativa como Distribuidora

**Fuente:** Ley 27.424, Arts. 12 y 14 [Ley 27.424]; Res. 314/2018 [Res. 314/2018].

| Aspecto | Detalle |
|---|---|
| Producción del dato | La cooperativa-distribuidora genera datos de facturación y medición; debe reflejar en factura el volumen demandado, el inyectado y los precios de cada uno |
| Validación | Ente Regulador Jurisdiccional (provincial); AFIP para aspectos fiscales [AFIP RG 5746/2025] |
| Efecto | **Comercial** — la cooperativa es responsable de la liquidación del balance neto |

---

### 2.5 Parque comunitario con cuotapartes

**Fuente:** Res. 314/2018, definición de "Contrato de Generación Eléctrica bajo Modalidad Distribuida Comunitaria" incorporada por Res. 608/2023 [Res. 608/2023].

| Aspecto | Detalle |
|---|---|
| Producción del dato | Cada participante declara su cuotaparte; el operador del parque registra generación |
| Validación | Distribuidora, al determinar factibilidad de conexión si el equipo no está vinculado a ningún punto de suministro |
| Efecto | **Comercial** — las cuotapartes determinan la distribución de créditos |

---

### 2.6 Planta de generación de propiedad cooperativa

**Fuente:** No explícitamente regulada como categoría propia en las fuentes consultadas. **Marcado como `(inferido)`.**

| Aspecto | Detalle |
|---|---|
| Producción del dato | La cooperativa como propietaria de la planta registra su generación |
| Validación | Depende de si la planta inyecta como Usuario-Generador bajo Ley 27.424 o bajo otro régimen (MEM, MATER) |
| Efecto | **Comercial**, pero el marco exacto requiere análisis adicional — ver §4 Open Questions |

---

### 2.7 Instalador / SCADA del inversor

**Fuente:** Res. 314/2018, Procedimiento de conexión (Formulario 2A) [Res. 314/2018]; ENRE [ENRE].

| Aspecto | Detalle |
|---|---|
| Producción del dato | Instalador calificado completa Formulario 2A con datos técnicos; el inversor / SCADA produce curva de generación |
| Validación | Distribuidora valida Formulario 2A; el SCADA **no** es validado como instrumento comercial |
| Efecto | **Solo operativo** — los datos de SCADA no entran en la liquidación del balance neto |

**Nota crítica:** para usuarios con potencia > 10 kW, el generador debe poner a disposición del Distribuidor la curva de carga de generación (telemedición o claves de acceso web), pero esto es para fines estadísticos y cálculo del VAD, no para liquidación comercial [Res. 314/2018, Anexo].

---

### 2.8 Medidor del Distribuidor (bidireccional)

**Fuente:** Ley 27.424, Art. 12 [Ley 27.424]; Res. 314/2018 [Res. 314/2018].

| Aspecto | Detalle |
|---|---|
| Producción del dato | El Distribuidor instala y lee el medidor bidireccional |
| Validación | Distribuidora; Ente Regulador Jurisdiccional fiscaliza |
| Efecto | **Comercial** — es la única fuente válida para la liquidación del balance neto |

---

## 3. Créditos de generación BeEnergy vs. certificados I-REC

Esta sección define el **límite de integración** entre los créditos de generación internos de BeEnergy y cualquier flujo I-REC / I-TRACK (E). Es normativa para el diseño: cualquier integración futura debe respetarla.

### 3.1 Qué es un crédito de generación BeEnergy

- Un **crédito de generación** es una unidad interna de asignación cooperativa: representa kWh generados por un equipo y asignados a los miembros de la cooperativa según cuotapartes.
- Se calcula a partir de datos de medición (medidor bidireccional para liquidación comercial; SCADA solo como dato operativo).
- **No es** un certificado, **no es** transferible fuera de la cooperativa, **no** representa un atributo ambiental certificado, y **no** habilita declaraciones ESG / Scope 2.
- Su estado es interno: `assigned`, `settled`, etc. — nunca `issued`, `transferred` ni `retired` en el sentido de un registro formal.

### 3.2 Separación de responsabilidades en un flujo I-REC

Si en el futuro se integra un proveedor I-REC, cada responsabilidad debe vivir en un componente distinto y **nunca** mezclarse con el modelo de créditos internos:

| Responsabilidad | Quién la ejerce | Dónde vive en BeEnergy |
|---|---|---|
| **Registro (registration)** | El registro I-REC (operado por Evident) mantiene las cuentas de participantes | Fuera de BeEnergy; solo se referencia por `provider_id` opaco |
| **Emisor (issuer)** | IRAM como emisor autorizado de I-TRACK (E) / I-REC en Argentina | Fuera de BeEnergy; se referencia por identificador de emisor |
| **Emisión (issuance)** | El emisor emite certificados por 1 MWh de atributos ambientales, contra evidencia de generación | Fuera de BeEnergy; BeEnergy solo puede aportar evidencia de medición, nunca emitir |
| **Transferencia (transfer)** | El registro transfiere la titularidad de certificados entre cuentas | Fuera de BeEnergy; BeEnergy no transfiere certificados |
| **Retiro (retirement)** | El registro retira certificados para una declaración de consumo | Fuera de BeEnergy; BeEnergy no retira ni declara en nombre de nadie |

Regla: BeEnergy **no** es registro, **no** es emisor, **no** emite, **no** transfiere y **no** retira certificados. Solo puede, en un futuro aprobado, actuar como fuente de evidencia de generación.

### 3.3 Identificadores de proveedor y estado formal separados

- Cualquier identificador de proveedor I-REC (registro, emisor, cuenta, certificado) es un **campo opaco y separado** (`provider_id`, `issuer_id`, `certificate_id`), nunca reutiliza el `id` de un crédito de generación BeEnergy.
- El **estado formal** de un certificado (`issued`, `transferred`, `retired`) es un dominio distinto del estado de un crédito interno (`assigned`, `settled`). No se mapean uno a uno ni se comparten enums.
- Un crédito de generación BeEnergy **no puede** marcarse como `issued` / `certified` / `I-REC` en el modelo de datos.

### 3.4 Sin afirmaciones formales hasta acuerdo y decisión de producto

- BeEnergy **no** debe enviar datos a un registro, **no** debe solicitar emisión, y **no** debe representar (en UI, docs, API o marketing) que un crédito interno es un I-REC, hasta que existan:
  1. un **acuerdo de proveedor aprobado**, y
  2. una **decisión de producto** explícita que defina el alcance.
- Mientras no existan ambos, cualquier integración I-REC es solo un límite documentado, no una funcionalidad.

### 3.5 Migración y rollout

- No hay migración de datos: los créditos de generación existentes permanecen como créditos internos; no se reetiquetan como certificados.
- Si en el futuro se agregan campos de proveedor, deben ser **aditivos y opcionales** (nullable), sin alterar el significado de los créditos existentes.
- Cualquier cambio de etiquetado debe revisarse contra este documento y contra `docs/domain-model.md` §0.

---

## 4. Open Questions

- ¿La planta de propiedad cooperativa (§2.6) opera bajo Ley 27.424 o bajo otro régimen (MEM/MATER)?
- ¿Qué evidencia de medición aceptaría un emisor I-REC para emitir, y bajo qué acuerdo de proveedor?
- ¿Qué decisión de producto habilitaría (si alguna) una integración I-REC, y con qué alcance?

---

## 5. Referencias

- Ley 27.424 — Régimen de Fomento a la Generación Distribuida de Energía Renovable.
- Res. 314/2018 — Anexo, procedimiento de conexión y balance neto.
- Res. 287/2025 — Categorías de Usuario-Generador.
- Res. 608/2023 — Contrato de Generación Eléctrica bajo Modalidad Distribuida Comunitaria.
- AFIP RG 5746/2025 — Aspectos fiscales.
- IRAM I-TRACK page — Emisor autorizado de I-TRACK (E) / I-REC en Argentina.
- ENRE — Ente Nacional Regulador de la Electricidad.

---

## 6. Nota sobre créditos internos

Los créditos de generación BeEnergy se asignan internamente a los miembros de la cooperativa. No son un mercado de certificados externo ni una afirmación de certificación I-REC/ESG. Ver §3 para el límite de integración.
