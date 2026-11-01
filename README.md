# Simulador de Consola RM

Simulador de entrenamiento de una consola de resonancia magnética, inspirado en el flujo de trabajo de syngo MR. Corre completo en el navegador, sin servidor ni instalación.

**Usarlo:** https://cgolivaresv.github.io/simulador-consola-rm/

> Proyecto educativo independiente. No está afiliado a Siemens Healthineers ni a United Imaging, y no usa sus marcas ni su software.

## Qué hace hoy

- **Patient**: worklist de ejemplo (pacientes ficticios) y registro con nombre, ID, fecha de nacimiento, sexo, estatura y peso (obligatorios para el SAR), posición, bobina y programa. Sin registro no se puede entrar a Exam.
- **Localizer en 3 planos** (sagital, coronal, transversal). Sin localizer medido no se puede medir ningún otro protocolo.
- **Protocolos transversales, sagitales y coronales**: *Main orientation* por protocolo, con sus angulaciones (T>C/T>S, S>T/S>C, C>T/C>S), rotación del FoV y dirección de fase con las letras de cada plano (R>>L, A>>P, H>>F). La librería incluye T2 y T1 sagitales, T2 y FLAIR coronales y un T2 coronal de hipocampo.
- **Planificar sobre cualquier serie medida**: cada segmento de planificación tiene un selector para mostrar su localizer o una serie ya medida, que se recorre corte a corte con la rueda. Por ejemplo, el coronal de hipocampo se angula sobre el T2 sagital.
- **Planificación gráfica del slice group** en los tres localizers: arrastrar para mover (R-L, A-P, F-H) en cualquiera; los puntos de rotación angulan T > C en el sagital y T > S en el coronal, y rotan el FoV en el plano en el transversal, para cortes oblicuos y doble oblicuos. Cada corte se dibuja donde su plano corta el localizer. Caja de FoV, oversampling de fase y dirección de fase en el transversal. Los valores (incluida la orientación tipo «T > C -12.0 > S 4.5») se reflejan en la tarjeta Geometry, donde también se pueden escribir, y la vista previa recalcula los cortes. Botón *Copiar posición* desde la última serie medida.
- **Cerrar examen**: termina el examen y lo marca como completado en la worklist (estados Programado, En curso, Completado) para seguir con el siguiente paciente, o **empieza desde cero**, borrando también los estudios importados y las series 3D.
- **Program Library** (Head › Brain) y **Exam Queue** con estados pendiente / midiendo / medido, TA por protocolo y tiempo restante del examen.
- **Tarjetas de parámetros** Routine, Contrast, Resolution y Sequence, con nombres de parámetros como en consola (TR, TE, TI, Flip angle, Turbo factor, Base resolution, Phase resolution, Phase oversampling, Accel. factor PE, Bandwidth, RF pulse type…).
- **Restricciones reales**: TE efectivo múltiplo del echo spacing en TSE, TE y TR mínimos según bandwidth/turbo factor/TI, concatenaciones cuando los cortes no caben en un TR, bloqueo por SAR.
- **Línea de información** tipo consola: TA, PAT, voxel size, Rel. SNR (relativo al protocolo al abrirlo) y SAR estimado.
- **Vista previa en vivo** del protocolo abierto y **segmento de serie** con las imágenes medidas: ventana/centro arrastrando, rueda para cortes, doble clic para ventana automática, overlays SP/SL/FoV/TR/TE/TA.
- **Fantoma BrainWeb (anatomía real)** por defecto: cerebro segmentado a 1 mm con grasa, músculo, hueso, LCR, sustancias gris y blanca y vasos (vacío de flujo en spin echo, señal de entrada en gradient echo). Patologías precalculadas sobre esa anatomía: carga lesional de EM (periventriculares tipo dedos de Dawson, yuxtacorticales, infratentoriales) e infarto agudo de ACM izquierda con restricción en difusión.
- **Datos propios, procesados solo en el navegador**: mapas cuantitativos T1/T2/PD (por ejemplo MAGiC/MDME) o segmentaciones (FreeSurfer, SynthSeg, FSL FAST) en DICOM sin comprimir o NIfTI. Al leerlos se descartan nombre, ID, fechas, institución, médicos, UIDs y tags privados, con un informe de lo encontrado; opción de *defacing* simple. Nada se sube a ningún servidor.
- **Tarea 3D (MPR) con adquisiciones reales**: carga la carpeta de una serie volumétrica (T1 MPRAGE, SPACE, CUBE, FLAIR 3D…) en DICOM clásico, multiframe Enhanced MR o NIfTI. Lee DICOM sin compresión, RLE, JPEG Lossless, JPEG 2000 (incluido HTJ2K) y JPEG-LS; separa ecos, dinámicos y stacks en volúmenes distintos y avisa si los cortes no son volumétricos o el espaciado es irregular. Tres planos con cruz enlazada: mover el centro, desplazar planos arrastrando su línea, rotar con los puntos para planos oblicuos y doble oblicuos (la vista donde rotas se mantiene derecha), avanzar con la rueda. Slab MPR, MIP, MinIP y promedio; ventana enlazada, zoom, desplazamiento y medición de distancia. **Rangos paralelos** para crear series reformateadas (por ejemplo coronales de 3 mm cada 3,5 mm) que se revisan en el cuarto segmento. Todo se procesa en el navegador: los datos identificatorios se descartan al leer y nada se sube a ningún servidor. Incluye un volumen de ejemplo T1 3D sintético hecho con BrainWeb.
- **Examinar estudios importados en la consola**: desde la tarea 3D, las series cargadas se convierten en un paciente de la worklist (anonimizado) y el examen se hace con el flujo normal. Dos modos:
  - *Anatomía real*: cada protocolo muestra la serie del estudio con la potenciación más parecida (T1, T2, PD, FLAIR, STIR, T2*, DWI), reformateada con la geometría del protocolo: grosor con volumen parcial, matriz, FoV, angulación, aliasing y ruido según el SNR. Conserva la patología real del paciente. Si falta una potenciación, usa la más cercana y lo avisa. La serie usada aparece en el overlay.
  - *Contraste sintético*: clasifica cada vóxel en tejido (sustancia blanca, gris, LCR, grasa, músculo, hueso) a partir de T1 3D y, si están, T2, FLAIR (lesiones de sustancia blanca) y ADC o DWI (restricción). Luego cualquier TR, TE o TI cambia el contraste sobre la anatomía del paciente. Patología fuera de esas clases no se modela.
  La potenciación de cada serie se detecta por nombre (convenciones Siemens y GE) y parámetros, y se puede corregir a mano.
- **Fantoma geométrico 3D** alternativo (cuero cabelludo, díploe, LCR, corteza con surcos, sustancia blanca, ventrículos, núcleos basales, fosa posterior, órbitas) con patologías: lesiones de sustancia blanca tipo EM e infarto agudo de ACM izquierda.
- **Física**: ecuaciones de señal SE/TSE, IR (FLAIR/STIR), GRE (FLASH) y EPI de difusión (b, ADC); ruido Rician según SNR; aliasing (wrap-around) al reducir FoV phase; ghost N/2 en EPI; supresión grasa; 1.5 T y 3 T. Las imágenes se calculan en un Web Worker, así la interfaz no se traba al planificar.

## Próximos pasos

1. Más sujetos BrainWeb y localizers de varios cortes.
2. Más regiones y protocolos (columna, rodilla, abdomen) y fantomas.
3. Tarjeta Physio / Inline y bobinas.
4. Modo instructor con casos y evaluación.

## Desarrollo

Requiere Node 22.

```bash
npm install
npm run dev        # servidor local con recarga en vivo: http://localhost:5173
npm test           # pruebas de física, geometría, BrainWeb e importación
npm run build      # verifica tipos y genera dist/
```

Cada push a `main` corre las pruebas, compila y publica `dist/` en la rama `gh-pages` (GitHub Actions, `.github/workflows/publicar.yml`). Si una prueba falla, no se publica.

## Estructura

```
index.html                 Marcado de la consola
src/main.ts                Punto de entrada: conecta controles y carga BrainWeb
src/core/                  Tipos (coordenadas LPS, protocolo, volumen) y utilidades
src/physics/               Tabla de tejidos, timing/SNR/SAR del protocolo, ecuaciones de señal, potenciación
src/phantom/               Fantoma geométrico, BrainWeb, muestreo de volúmenes y estudios importados (anatomía real y contraste sintético)
src/imaging/               Geometría de cortes, reconstrucción y Web Worker
src/importer/              Lectura DICOM (dicom-parser) y NIfTI, anonimización, armado de fantomas
src/volume/                Series volumétricas: decodificadores, DICOM clásico y multiframe, armado de volúmenes
src/mpr/                   Geometría MPR, planos oblicuos, reformateo con slab, rangos paralelos
src/ui/                    Tarjeta de parámetros, cola, visor y planificación, medición, paciente, tarea 3D
public/brainweb.gz.txt     Fantoma BrainWeb a 1 mm (gzip + base64, ~730 KB)
test/                      Pruebas (Vitest); test/fixtures tiene DICOM falsos con datos inventados
tools/prep_brainweb.py     Script que genera brainweb.gz.txt
tools/make_volume_fixtures.py  Genera las series de prueba en cada compresión (pydicom + GDCM)
```

## Créditos

- Decodificadores: [dicom-parser](https://github.com/cornerstonejs/dicomParser), [OpenJPEG](https://github.com/cornerstonejs/codecs) y [CharLS](https://github.com/cornerstonejs/codecs) compilados a WebAssembly por Cornerstone, y [jpeg-lossless-decoder-js](https://github.com/rii-mango/JPEGLosslessDecoderJS) (licencias MIT).

- Anatomía: **BrainWeb**, McConnell Brain Imaging Centre (MNI). Cocosco CA, Kollokian V, Kwan RK-S, Evans AC. *BrainWeb: Online Interface to a 3D MRI Simulated Brain Database*. NeuroImage 1997;5(4):S425. Collins DL et al. *Design and construction of a realistic digital brain phantom*. IEEE TMI 1998;17(3):463-468.
- Volumen de etiquetas obtenido del fantoma 3D incluido en [KomaMRI.jl](https://github.com/JuliaHealth/KomaMRI.jl) (licencia MIT). Castillo-Passi C et al. *KomaMRI.jl: An open-source framework for general MRI simulations with GPU acceleration*. Magn Reson Med 2023.
