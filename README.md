# Simulador de Consola RM

Simulador de entrenamiento de una consola de resonancia magnética, inspirado en el flujo de trabajo de syngo MR. Corre completo en el navegador, sin servidor ni instalación: abre `index.html`.

> Proyecto educativo independiente. No está afiliado a Siemens Healthineers ni a United Imaging, y no usa sus marcas ni su software.

## Qué hace hoy

- **Patient**: worklist de ejemplo (pacientes ficticios) y registro con nombre, ID, fecha de nacimiento, sexo, estatura y peso (obligatorios para el SAR), posición, bobina y programa. Sin registro no se puede entrar a Exam.
- **Localizer en 3 planos** (sagital, coronal, transversal). Sin localizer medido no se puede medir ningún otro protocolo.
- **Planificación gráfica del slice group** sobre los localizers: arrastrar para mover (R-L, A-P, F-H), arrastrar el punto del sagital para angular T > C, caja de FoV, oversampling de fase y dirección de fase en el transversal. Los valores se reflejan en la tarjeta Geometry y la vista previa recalcula los cortes angulados. Botón *Copiar posición* desde la última serie medida.
- **Program Library** (Head › Brain) y **Exam Queue** con estados pendiente / midiendo / medido, TA por protocolo y tiempo restante del examen.
- **Tarjetas de parámetros** Routine, Contrast, Resolution y Sequence, con nombres de parámetros como en consola (TR, TE, TI, Flip angle, Turbo factor, Base resolution, Phase resolution, Phase oversampling, Accel. factor PE, Bandwidth, RF pulse type…).
- **Restricciones reales**: TE efectivo múltiplo del echo spacing en TSE, TE y TR mínimos según bandwidth/turbo factor/TI, concatenaciones cuando los cortes no caben en un TR, bloqueo por SAR.
- **Línea de información** tipo consola: TA, PAT, voxel size, Rel. SNR (relativo al protocolo al abrirlo) y SAR estimado.
- **Vista previa en vivo** del protocolo abierto y **segmento de serie** con las imágenes medidas: ventana/centro arrastrando, rueda para cortes, doble clic para ventana automática, overlays SP/SL/FoV/TR/TE/TA.
- **Fantoma BrainWeb (anatomía real)** por defecto: cerebro segmentado a 1 mm con grasa, músculo, hueso, LCR, sustancias gris y blanca y vasos (vacío de flujo en spin echo, señal de entrada en gradient echo). Patologías precalculadas sobre esa anatomía: carga lesional de EM (periventriculares tipo dedos de Dawson, yuxtacorticales, infratentoriales) e infarto agudo de ACM izquierda con restricción en difusión.
- **Datos propios, procesados solo en el navegador**: mapas cuantitativos T1/T2/PD (por ejemplo MAGiC/MDME) o segmentaciones (FreeSurfer, SynthSeg, FSL FAST) en DICOM sin comprimir o NIfTI. Al leerlos se descartan nombre, ID, fechas, institución, médicos, UIDs y tags privados, con un informe de lo encontrado; opción de *defacing* simple. Nada se sube a ningún servidor.
- **Fantoma geométrico 3D** alternativo (cuero cabelludo, díploe, LCR, corteza con surcos, sustancia blanca, ventrículos, núcleos basales, fosa posterior, órbitas) con patologías: lesiones de sustancia blanca tipo EM e infarto agudo de ACM izquierda.
- **Física**: ecuaciones de señal SE/TSE, IR (FLAIR/STIR), GRE (FLASH) y EPI de difusión (b, ADC); ruido Rician según SNR; aliasing (wrap-around) al reducir FoV phase; ghost N/2 en EPI; supresión grasa; 1.5 T y 3 T.

## Próximos pasos

1. Protocolos en orientación sagital y coronal, y más sujetos BrainWeb.
2. Más regiones y protocolos (columna, rodilla, abdomen) y fantomas.
3. Tarjeta Physio / Inline y bobinas.
4. Modo instructor con casos y evaluación.

## Estructura

```
index.html               Aplicación completa (HTML + CSS + JS, sin dependencias)
brainweb.gz.txt          Fantoma BrainWeb a 1 mm (gzip + base64, ~730 KB)
tools/prep_brainweb.py   Script que genera brainweb.gz.txt
```

Para abrirlo localmente sirve la carpeta con un servidor estático (por ejemplo `python3 -m http.server`); abriendo `index.html` directo desde el disco el navegador bloquea la carga de BrainWeb y se usa el fantoma geométrico.

## Créditos

- Anatomía: **BrainWeb**, McConnell Brain Imaging Centre (MNI). Cocosco CA, Kollokian V, Kwan RK-S, Evans AC. *BrainWeb: Online Interface to a 3D MRI Simulated Brain Database*. NeuroImage 1997;5(4):S425. Collins DL et al. *Design and construction of a realistic digital brain phantom*. IEEE TMI 1998;17(3):463-468.
- Volumen de etiquetas obtenido del fantoma 3D incluido en [KomaMRI.jl](https://github.com/JuliaHealth/KomaMRI.jl) (licencia MIT). Castillo-Passi C et al. *KomaMRI.jl: An open-source framework for general MRI simulations with GPU acceleration*. Magn Reson Med 2023.
