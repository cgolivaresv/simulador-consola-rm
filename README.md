# Simulador de Consola RM

Simulador de entrenamiento de una consola de resonancia magnética, inspirado en el flujo de trabajo de syngo MR. Corre completo en el navegador, sin servidor ni instalación: abre `index.html`.

> Proyecto educativo independiente. No está afiliado a Siemens Healthineers ni a United Imaging, y no usa sus marcas ni su software.

## Qué hace hoy

- **Program Library** (Head › Brain) y **Exam Queue** con estados pendiente / midiendo / medido, TA por protocolo y tiempo restante del examen.
- **Tarjetas de parámetros** Routine, Contrast, Resolution y Sequence, con nombres de parámetros como en consola (TR, TE, TI, Flip angle, Turbo factor, Base resolution, Phase resolution, Phase oversampling, Accel. factor PE, Bandwidth, RF pulse type…).
- **Restricciones reales**: TE efectivo múltiplo del echo spacing en TSE, TE y TR mínimos según bandwidth/turbo factor/TI, concatenaciones cuando los cortes no caben en un TR, bloqueo por SAR.
- **Línea de información** tipo consola: TA, PAT, voxel size, Rel. SNR (relativo al protocolo al abrirlo) y SAR estimado.
- **Vista previa en vivo** del protocolo abierto y **segmento de serie** con las imágenes medidas: ventana/centro arrastrando, rueda para cortes, doble clic para ventana automática, overlays SP/SL/FoV/TR/TE/TA.
- **Fantoma de cabeza procedural 3D** (cuero cabelludo, díploe, LCR, corteza con surcos, sustancia blanca, ventrículos, núcleos basales, fosa posterior, órbitas) con patologías: lesiones de sustancia blanca tipo EM e infarto agudo de ACM izquierda.
- **Física**: ecuaciones de señal SE/TSE, IR (FLAIR/STIR), GRE (FLASH) y EPI de difusión (b, ADC); ruido Rician según SNR; aliasing (wrap-around) al reducir FoV phase; ghost N/2 en EPI; supresión grasa; 1.5 T y 3 T.

## Próximos pasos

1. Flujo de paciente → localizer en 3 planos → planificación de cortes arrastrando el slice group.
2. Más regiones y protocolos (columna, rodilla, abdomen) y fantomas.
3. Tarjeta Physio / Inline y bobinas.
4. Modo instructor con casos y evaluación.

## Estructura

```
index.html   Aplicación completa (HTML + CSS + JS, sin dependencias)
```
