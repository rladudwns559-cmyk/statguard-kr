import base64
import copy
import hashlib
import importlib.util
import io
import json
from email.message import Message
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('statguard_cloud_handler',ROOT/'frontend/api/statguard.py')
cloud=importlib.util.module_from_spec(spec);spec.loader.exec_module(cloud)
from _statguard_runtime.local_bridge import calculate_request,preview_hash
from _statguard_runtime.core import load_csv_bytes

def request(raw='연도,값\n2022,1000\n2023,1178\n'.encode(),encoding='utf-8-sig'):
    table=load_csv_bytes(raw,dataset_id='local-upload',encoding=encoding)
    return {'mode':'calculate','request_id':'11111111-1111-4111-8111-111111111111',
        'csv_base64':base64.b64encode(raw).decode(),'source_sha256':hashlib.sha256(raw).hexdigest(),
        'preview_sha256':preview_hash(table.columns,table.rows),'encoding':encoding,'units':{'값':'명'},
        'spec':{'operation':'sum','column':'값','filters':{},'reference_filters':None,'group_by':None,'aggregation':None,'missing_policy':'reject'}}

def headers(**changes):
    values={'Host':'when2warn-public-beta.vercel.app','Origin':'https://when2warn-public-beta.vercel.app',
        'X-StatGuard-Client':'cloud-v0.1','Content-Type':'application/json','Content-Length':'100'}
    values.update(changes);result=Message()
    for k,v in values.items():
        if v is not None:result[k]=v
    return result

class CloudTransport(unittest.TestCase):
    def test_exact_runtime_bundle_matches_existing_engine(self):
        for name in ['core.py','local_bridge.py','claims.py','live_ask.py','forensics.py']:
            self.assertEqual((ROOT/'src/when2warn/statguard'/name).read_bytes(),(ROOT/'frontend/_statguard_runtime'/name).read_bytes())

    def test_existing_engine_sum_and_comparison_are_preserved(self):
        req=request();status,result=cloud.process_body(json.dumps(req).encode())
        self.assertEqual(status,200);self.assertEqual(result,calculate_request(req))
        r=result['result'];comparison={'mode':'compare','request_id':req['request_id'],'calculation':req,
            'expected_dataset_version':r['dataset_version'],'expected_calculation_id':r['calculation_id'],
            'claim_value':'2200','claim_unit':'명','tolerance_absolute':'0'}
        code,value=cloud.process_body(json.dumps(comparison).encode())
        self.assertEqual(code,200);self.assertEqual(value['display_status'],'MISMATCH');self.assertEqual(value['difference']['absolute'],'22')

    def test_percentage_keeps_separate_baseline_and_percentage_point(self):
        req=request();req['spec'].update(operation='percent_change',filters={'연도':'2023'},reference_filters={'연도':'2022'})
        code,value=cloud.process_body(json.dumps(req).encode());r=value['result']
        self.assertEqual((code,r['value'],r['unit']),(200,'17.8','%'))
        self.assertEqual(r['usage']['used_rows'],[2]);self.assertEqual(r['reference_usage']['used_rows'],[1])

    def test_cp949_and_original_hash_roundtrip(self):
        req=request('연도,값\n2022,10\n2023,20'.encode('cp949'),encoding='cp949')
        self.assertEqual(cloud.process_body(json.dumps(req).encode())[1]['result']['value'],'30')
        req['source_sha256']='0'*64
        self.assertEqual(cloud.process_body(json.dumps(req).encode())[1]['error']['code'],'SOURCE_MISMATCH')

    def test_two_requests_do_not_share_previous_values(self):
        one=request();two=request('연도,값\n2022,1\n2023,2'.encode())
        a=cloud.process_body(json.dumps(one).encode())[1];b=cloud.process_body(json.dumps(two).encode())[1]
        self.assertEqual(a['result']['value'],'2178');self.assertEqual(b['result']['value'],'3')
        self.assertNotEqual(a['result']['dataset_version'],b['result']['dataset_version'])

    def test_same_origin_production_and_preview_are_accepted(self):
        self.assertIsNone(cloud.validate_headers(headers()))
        host='when2warn-public-beta-test-rladudwns559-6256.vercel.app'
        self.assertIsNone(cloud.validate_headers(headers(Host=host,Origin='https://'+host)))

    def test_cross_origin_missing_origin_and_cross_site_are_rejected(self):
        for fields in [{'Origin':'https://other.invalid'},{'Origin':None},{'Sec-Fetch-Site':'cross-site'},
            {'Host':'other.invalid','Origin':'https://other.invalid'},{'Origin':'http://when2warn-public-beta.vercel.app'}]:
            with self.subTest(case=list(fields)):
                self.assertEqual(cloud.validate_headers(headers(**fields))[0],403)

    def test_multipart_form_and_missing_custom_header_are_rejected(self):
        self.assertEqual(cloud.validate_headers(headers(**{'Content-Type':'multipart/form-data'}))[0],415)
        self.assertEqual(cloud.validate_headers(headers(**{'X-StatGuard-Client':None}))[0],403)

    def test_content_length_missing_negative_duplicate_and_excessive(self):
        for value in [None,'-1','1.0','0',' 2']:
            self.assertEqual(cloud.validate_headers(headers(**{'Content-Length':value}))[0],400)
        duplicate=headers();duplicate['Content-Length']='100'
        self.assertEqual(cloud.validate_headers(duplicate)[0],400)
        self.assertEqual(cloud.validate_headers(headers(**{'Content-Length':str(cloud.MAX_REQUEST_BYTES+1)}))[0],413)
        self.assertEqual(cloud.process_body(b' '* (cloud.MAX_REQUEST_BYTES+1))[0],413)

    def test_invalid_json_duplicate_keys_nonfinite_and_unsupported_mode(self):
        for raw in [b'{',b'[]',b'{"mode":"calculate","mode":"compare"}',b'{"value":NaN}',b'{"mode":"capabilities"}',b'\xff']:
            with self.subTest(length=len(raw)):
                self.assertEqual(cloud.process_body(raw)[0],400)

    def test_processing_does_not_open_files_or_call_network(self):
        raw=json.dumps(request()).encode()
        with patch('builtins.open',side_effect=AssertionError('File access forbidden')),patch('socket.socket',side_effect=AssertionError('Network forbidden')):
            self.assertEqual(cloud.process_body(raw)[0],200)

    def test_exception_is_sanitized_and_does_not_reach_stdout_stderr(self):
        out=io.StringIO();err=io.StringIO();marker='SYNTHETIC_PRIVATE_DIAGNOSTIC_DO_NOT_ECHO'
        with patch.object(cloud,'calculate_request',side_effect=RuntimeError(marker)),patch('sys.stdout',out),patch('sys.stderr',err):
            status,response=cloud.process_body(b'{"mode":"calculate"}')
        self.assertEqual(status,400);self.assertNotIn(marker,json.dumps(response)+out.getvalue()+err.getvalue())

    def test_oversized_response_is_rejected(self):
        with patch.object(cloud,'calculate_request',return_value={'ok':True,'value':'x'*cloud.MAX_RESPONSE_BYTES}):
            self.assertEqual(cloud.process_body(b'{"mode":"calculate"}')[0],413)

    def make_handler(self,raw=b'{}',**fields):
        obj=object.__new__(cloud.handler);obj.headers=headers(**{'Content-Length':str(len(raw)),**fields});obj.rfile=io.BytesIO(raw);obj.wfile=io.BytesIO();obj.responses=[]
        obj._send=lambda status,body:obj.responses.append((status,body));return obj

    def test_rejected_headers_do_not_read_body(self):
        obj=self.make_handler(Origin='https://other.invalid');obj.rfile=unittest.mock.Mock();obj.do_POST()
        obj.rfile.read.assert_not_called();self.assertEqual(obj.responses[0][0],403)

    def test_incomplete_body_and_busy_never_execute(self):
        obj=self.make_handler(**{'Content-Length':'20'})
        with patch.object(cloud,'process_body') as process:
            obj.do_POST();process.assert_not_called();self.assertEqual(obj.responses[0][1]['error']['code'],'INCOMPLETE_REQUEST')
        cloud._active.acquire();cloud._active.acquire()
        try:
            obj=self.make_handler();obj.do_POST();self.assertEqual(obj.responses[0][0],429)
        finally:cloud._active.release();cloud._active.release()

    def test_http_response_is_no_store_and_does_not_allow_cross_origin(self):
        obj=object.__new__(cloud.handler);obj.wfile=io.BytesIO();seen={}
        obj.send_response=lambda code:seen.update(status=code)
        obj.send_header=lambda name,value:seen.update({name:value});obj.end_headers=lambda:None
        obj._send(400,cloud.error('INVALID_REQUEST'))
        self.assertIn('no-store',seen['Cache-Control']);self.assertNotIn('Access-Control-Allow-Origin',seen)
        self.assertEqual(json.loads(obj.wfile.getvalue())['error']['code'],'INVALID_REQUEST')

if __name__=='__main__':unittest.main()
