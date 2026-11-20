"""Local UI transport tests; synthetic bytes only, no provider/DB/HTTP client."""
import base64
import copy
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import sys
import unittest
from unittest.mock import patch

from when2warn.statguard.local_bridge import calculate_request, preview_hash
from when2warn.statguard.core import load_csv_bytes

ROOT=Path(__file__).resolve().parents[1]
RAW='지역,연도,인원\nA,2023,1000\nA,2024,1178\nB,2024,960\n'.encode()


def request(raw=RAW,encoding='utf-8-sig',**spec):
    table=load_csv_bytes(raw,dataset_id='local-upload',encoding=encoding)
    return {'mode':'calculate','request_id':'11111111-1111-4111-8111-111111111111',
            'csv_base64':base64.b64encode(raw).decode(), 'source_sha256':hashlib.sha256(raw).hexdigest(),
            'preview_sha256':preview_hash(table.columns,table.rows),'encoding':encoding,'units':{'인원':'명'},
            'spec':{'operation':'sum','column':'인원','filters':{},'reference_filters':None,'group_by':None,'aggregation':None,'missing_policy':'reject',**spec}}


class LocalCalculation(unittest.TestCase):
    def code(self,payload,code):
        value=calculate_request(payload)
        self.assertFalse(value['ok']);self.assertEqual(value['error']['code'],code)

    def test_capabilities_are_not_provider_or_persistence(self):
        value=calculate_request({'mode':'capabilities'})
        self.assertEqual(value['operations'],['mean','percent_change','sum'])
        self.assertEqual((value['provider'],value['storage']),('NONE','MEMORY_ONLY'))

    def test_sum_and_exact_core_row_linkage(self):
        result=calculate_request(request())['result']
        self.assertEqual(result['value'],'3138');self.assertEqual(result['usage']['used_rows'],[1,2,3])
        self.assertEqual(result['expression'],'sum(인원) = 3138')
        self.assertEqual(result['unit'],'명');self.assertEqual(len(result['calculation_id']),64)

    def test_mean_and_expression(self):
        result=calculate_request(request(operation='mean'))['result']
        self.assertEqual(result['value'],'1046');self.assertEqual(result['expression'],'3138 / 3')

    def test_percent_change_has_separate_current_and_base_rows(self):
        result=calculate_request(request(operation='percent_change',filters={'지역':'A','연도':'2024'},reference_filters={'지역':'A','연도':'2023'}))['result']
        self.assertEqual(result['value'],'17.8');self.assertEqual(result['unit'],'%')
        self.assertEqual(result['expression'],'(1178 - 1000) / 1000 * 100')
        self.assertEqual(result['usage']['used_rows'],[2]);self.assertEqual(result['reference_usage']['used_rows'],[1])

    def test_no_float_precision_loss(self):
        result=calculate_request(request('인원\n0.1\n0.2'.encode()))['result']
        self.assertEqual(result['value'],'0.3')

    def test_exact_numeric_limit_preserved(self):
        result=calculate_request(request('인원\n999999999999999999.999999\n0.000001'.encode()))['result']
        self.assertEqual(result['value'],'1000000000000000000')

    def test_source_and_interpretation_checks(self):
        for field,code in [('source_sha256','SOURCE_MISMATCH'),('preview_sha256','PREVIEW_INTERPRETATION_MISMATCH')]:
            payload=request();payload[field]='0'*64;self.code(payload,code)

    def test_cp949_original_bytes_and_preview(self):
        payload=request('지역,인원\n서울,10\n부산,20'.encode('cp949'),encoding='cp949')
        self.assertEqual(calculate_request(payload)['result']['value'],'30')

    def test_data_and_units_change_versions_and_filters_change_calculation(self):
        one=calculate_request(request())['result']
        payload=request();payload['units']={'인원':'건'}
        two=calculate_request(payload)['result']
        self.assertNotEqual(one['dataset_version'],two['dataset_version'])
        three=calculate_request(request(filters={'지역':'A'}))['result']
        self.assertEqual(one['dataset_version'],three['dataset_version'])
        self.assertNotEqual(one['calculation_id'],three['calculation_id'])

    def test_empty_numeric_values_require_explicit_omission(self):
        raw='인원\n10\n""\n20'.encode()
        self.code(request(raw),'MISSING_NUMERIC_VALUE')
        result=calculate_request(request(raw,missing_policy='omit'))['result']
        self.assertEqual(result['usage']['used_rows'],[1,3]);self.assertEqual(result['usage']['omitted_rows'],[2])
        self.assertIn('NUMERIC_ROWS_OMITTED',result['warnings'])

    def test_invalid_values_cannot_be_omitted(self):
        self.code(request('인원\n10\n=2+2'.encode(),missing_policy='omit'),'INVALID_NUMERIC_VALUE')

    def test_empty_selection(self):
        self.code(request(filters={'지역':'C'}),'EMPTY_SELECTION')

    def test_overlapping_and_zero_base_rejected(self):
        self.code(request(operation='percent_change',filters={'지역':'A'},reference_filters={'연도':'2023'}),'OVERLAPPING_COMPARISON')
        self.code(request('지역,연도,인원\nA,2023,0\nA,2024,1'.encode(),operation='percent_change',filters={'연도':'2024'},reference_filters={'연도':'2023'}),'NON_POSITIVE_BASELINE')

    def test_unit_must_be_explicit_and_only_for_target_column(self):
        payload=request();payload['units']={};self.code(payload,'UNIT_CONFIRMATION_REQUIRED')
        payload['units']={'인원':''};self.code(payload,'INVALID_UNIT_METADATA')
        payload['units']={'인원':'명','연도':'년'};self.code(payload,'UNIT_CONFIRMATION_REQUIRED')

    def test_only_three_ui_operations_and_no_arbitrary_fields(self):
        self.code(request(operation='rank',group_by='지역'),'UNSUPPORTED_OPERATION')
        payload=request();payload['spec']['code']='SYNTHETIC_UNTRUSTED';self.code(payload,'UNKNOWN_SPEC_FIELD')
        payload=request();payload['filename']='UNTRUSTED';self.code(payload,'INVALID_REQUEST')

    def test_request_types_ids_and_base64_bounded(self):
        for payload in [None,[],{}, {'mode':'live'}]:self.code(payload,'INVALID_REQUEST')
        for field,value in [('request_id','x'),('source_sha256','x'),('encoding','auto')]:
            payload=request();payload[field]=value;self.assertFalse(calculate_request(payload)['ok'])
        payload=request();payload['csv_base64']='!';self.code(payload,'INVALID_CSV_BASE64')
        payload['csv_base64']='A'*1_398_105;self.code(payload,'CSV_BYTE_LIMIT')

    def test_prototype_names_and_leading_zeros_stay_literal(self):
        payload=request('코드,인원\n001,10\n1,20'.encode(),filters={'코드':'001'})
        self.assertEqual(calculate_request(payload)['result']['value'],'10')

    def test_core_call_needs_no_network(self):
        with patch.object(socket,'socket',side_effect=AssertionError('NETWORK_FORBIDDEN')):
            self.assertEqual(calculate_request(request())['result']['value'],'3138')

    def test_exception_is_not_echoed(self):
        marker='SYNTHETIC_PRIVATE_VALUE'
        with patch('when2warn.statguard.local_bridge.execute',side_effect=RuntimeError(marker)):
            output=json.dumps(calculate_request(request()))
        self.assertNotIn(marker,output)

    def test_repeated_same_request_is_deterministic_and_does_not_modify_input(self):
        payload=request();saved=copy.deepcopy(payload)
        self.assertEqual(calculate_request(payload),calculate_request(payload));self.assertEqual(payload,saved)

    def test_stdin_cli_rejects_malformed_duplicate_fields_and_oversize_without_tracebacks(self):
        code='import sys;sys.path.insert(0,sys.argv[1]);from when2warn.statguard.local_bridge import main;main()'
        for raw in [b'{',b'{"mode":"capabilities","mode":"capabilities"}',b' '*1_500_001]:
            process=subprocess.run([sys.executable,'-I','-S','-B','-c',code,str(ROOT/'src')],input=raw,capture_output=True,timeout=5)
            self.assertEqual(process.returncode,0);self.assertFalse(json.loads(process.stdout)['ok']);self.assertEqual(process.stderr,b'')


if __name__=='__main__':unittest.main()
