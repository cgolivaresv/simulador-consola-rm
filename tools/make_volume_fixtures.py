"""Synthetic DICOM volume fixtures for the MPR loader tests. All patient data is invented.

A sagittal acquisition (slices along patient x) of 20 × 24 × 22 voxels, 2 mm isotropic.
Background 100, a bright 6 mm cube (value 1000) at patient left-anterior-head, so tests can check
that reformatted planes put it on the correct side.

Writes test/fixtures/vol/<variant>/*.dcm. Needs: pydicom, numpy, pylibjpeg-openjpeg, pyjpegls, python-gdcm.
"""
import os, shutil
import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.uid import (ExplicitVRLittleEndian, ImplicitVRLittleEndian, RLELossless, JPEG2000Lossless,
                         JPEGLSLossless, JPEGLosslessSV1, generate_uid)

OUT = os.path.join(os.path.dirname(__file__), '..', 'test', 'fixtures', 'vol')
NX_SL, ROWS, COLS, SP = 20, 24, 22, 2.0          # slices along x, rows along -z (head first), cols along +y
X0, Y0, Z0 = -19.0, -21.0, 23.0                   # patient position of slice 0, row 0, col 0

def volume(echo=1):
    v = np.full((NX_SL, ROWS, COLS), 100 * echo, np.uint16)
    # marker: x in [9, 15) left, y in [-15, -9) anterior, z in [13, 19) head
    for k in range(NX_SL):
        x = X0 + k * SP
        for r in range(ROWS):
            z = Z0 - r * SP
            for c in range(COLS):
                y = Y0 + c * SP
                if 9 <= x < 15 and -15 <= y < -9 and 13 <= z < 19:
                    v[k, r, c] = 1000
    return v

def base(meta_ts, sop_class='1.2.840.10008.5.1.4.1.1.4'):
    meta = FileMetaDataset()
    meta.TransferSyntaxUID = meta_ts
    meta.MediaStorageSOPClassUID = sop_class
    meta.MediaStorageSOPInstanceUID = generate_uid()
    ds = FileDataset('x', {}, file_meta=meta, preamble=b'\0' * 128)
    ds.SOPClassUID = sop_class
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.PatientName = 'FICTICIO^VOLUMEN'; ds.PatientID = '22222222-2'; ds.PatientBirthDate = '19800101'
    ds.InstitutionName = 'Centro Ejemplo'; ds.StudyDate = '20260101'; ds.ReferringPhysicianName = 'MEDICO^EJEMPLO'
    ds.Modality = 'MR'; ds.Manufacturer = 'Ejemplo'; ds.MagneticFieldStrength = 1.5
    ds.RepetitionTime = 2300; ds.EchoTime = 2.98; ds.InversionTime = 900; ds.FlipAngle = 9
    ds.SamplesPerPixel = 1; ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.Rows = ROWS; ds.Columns = COLS; ds.BitsAllocated = 16; ds.BitsStored = 16; ds.HighBit = 15; ds.PixelRepresentation = 0
    ds.add_new(0x00291010, 'OB', b'\1\2\3\4')
    return ds

def classic(name, ts, compress=None, echoes=(1,)):
    d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    series = generate_uid()
    for echo in echoes:
        v = volume(echo)
        for k in range(NX_SL):
            ds = base(ExplicitVRLittleEndian)
            ds.SeriesInstanceUID = series; ds.SeriesDescription = 't1_mprage_sag_p2_iso'; ds.InstanceNumber = k + 1
            ds.EchoNumbers = echo
            ds.ImageOrientationPatient = [0, 1, 0, 0, 0, -1]
            ds.ImagePositionPatient = [X0 + k * SP, Y0, Z0]
            ds.PixelSpacing = [SP, SP]; ds.SliceThickness = SP
            ds.PixelData = v[k].tobytes()
            fn = os.path.join(d, f'IM_{echo}_{k:04d}.dcm')
            if compress and compress != RLELossless:
                ds.save_as(fn, enforce_file_format=True)
                gdcm_transcode(fn, compress)
                continue
            if compress:
                ds.compress(compress)
            else:
                ds.file_meta.TransferSyntaxUID = ts
            ds.save_as(fn, enforce_file_format=True)

def gdcm_transcode(fn, ts_uid):
    """Small images trip pydicom's JPEG 2000 encoder and it has no JPEG Lossless encoder; GDCM handles all of them."""
    import gdcm
    r = gdcm.ImageReader(); r.SetFileName(fn)
    assert r.Read()
    ch = gdcm.ImageChangeTransferSyntax()
    ch.SetTransferSyntax(gdcm.TransferSyntax(gdcm.TransferSyntax.GetTSType(ts_uid)))
    ch.SetInput(r.GetImage())
    assert ch.Change()
    w = gdcm.ImageWriter(); w.SetFileName(fn); w.SetFile(r.GetFile()); w.SetImage(ch.GetOutput())
    assert w.Write()

def enhanced(name, compress=None):
    d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    v = volume()
    ds = base(ExplicitVRLittleEndian, '1.2.840.10008.5.1.4.1.1.4.1')
    ds.SeriesInstanceUID = generate_uid(); ds.SeriesDescription = 't1_mprage_sag_enhanced'; ds.InstanceNumber = 1
    ds.NumberOfFrames = NX_SL
    sh = Dataset()
    po = Dataset(); po.ImageOrientationPatient = [0, 1, 0, 0, 0, -1]; sh.PlaneOrientationSequence = [po]
    pm = Dataset(); pm.PixelSpacing = [SP, SP]; pm.SliceThickness = SP; sh.PixelMeasuresSequence = [pm]
    pv = Dataset(); pv.RescaleSlope = 1; pv.RescaleIntercept = 0; pv.RescaleType = 'US'; sh.PixelValueTransformationSequence = [pv]
    ds.SharedFunctionalGroupsSequence = [sh]
    frames = []
    for k in range(NX_SL):
        f = Dataset()
        pp = Dataset(); pp.ImagePositionPatient = [X0 + k * SP, Y0, Z0]; f.PlanePositionSequence = [pp]
        fc = Dataset(); fc.StackID = '1'; fc.InStackPositionNumber = k + 1; f.FrameContentSequence = [fc]
        frames.append(f)
    ds.PerFrameFunctionalGroupsSequence = frames
    # deliberately reverse the frames: the loader must sort by position, not by frame order
    order = list(range(NX_SL))[::-1]
    ds.PerFrameFunctionalGroupsSequence = [frames[i] for i in order]
    ds.PixelData = np.stack([v[i] for i in order]).tobytes()
    fn = os.path.join(d, 'ENHANCED.dcm')
    ds.save_as(fn, enforce_file_format=True)
    if compress:
        gdcm_transcode(fn, compress)

if __name__ == '__main__':
    shutil.rmtree(OUT, ignore_errors=True)
    classic('explicit', ExplicitVRLittleEndian)
    classic('implicit', ImplicitVRLittleEndian)
    classic('rle', None, RLELossless)
    classic('jpeg-lossless', None, JPEGLosslessSV1)
    classic('j2k', None, JPEG2000Lossless)
    classic('jpeg-ls', None, JPEGLSLossless)
    classic('dual-echo', ExplicitVRLittleEndian, echoes=(1, 2))
    enhanced('enhanced')
    enhanced('enhanced-j2k', JPEG2000Lossless)
    print('ok')
