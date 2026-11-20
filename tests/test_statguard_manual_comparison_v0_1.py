"""Manual scalar comparison with actual core arithmetic; synthetic input only."""
import base64,copy,hashlib,json,socket,unittest
from unittest.mock import patch
from when2warn.statguard.core import load_csv_bytes
from when2warn.statguard.local_bridge import calculate_request,preview_hash

RAW='지역,연도,수치\nA,2023,1000\nA,2024,1178\n'.encode()
def calculation(raw=RAW,operation='percent_change',unit='명',**spec):
 table=load_csv_bytes(raw,dataset_id='local-upload')
 filters={'연도':'2024'} if operation=='percent_change' else {}
 reference={'연도':'2023'} if operation=='percent_change' else None
 return {'mode':'calculate','request_id':'11111111-1111-4111-8111-111111111111','csv_base64':base64.b64encode(raw).decode(),'source_sha256':hashlib.sha256(raw).hexdigest(),'preview_sha256':preview_hash(table.columns,table.rows),'encoding':'utf-8-sig','units':{'수치':unit},'spec':{'operation':operation,'column':'수치','filters':filters,'reference_filters':reference,'group_by':None,'aggregation':None,'missing_policy':'reject',**spec}}
def request(value='23',tolerance='0',calc=None):
 calc=calc or calculation();result=calculate_request(calc)['result']
 return {'mode':'compare','request_id':'22222222-2222-4222-8222-222222222222','calculation':calc,'expected_dataset_version':result['dataset_version'],'expected_calculation_id':result['calculation_id'],'claim_value':value,'claim_unit':result['unit'],'tolerance_absolute':tolerance}

class ManualComparison(unittest.TestCase):
 def ok(self,payload):
  data=calculate_request(payload);self.assertTrue(data['ok']);return data
 def error(self,payload,code):
  data=calculate_request(payload);self.assertFalse(data['ok']);self.assertEqual(data['error']['code'],code)
 def test_exact_and_percentage_points(self):
  d=self.ok(request('17.8'));self.assertEqual(d['display_status'],'EXACT_MATCH');self.assertEqual(d['difference'],{'signed':'0','absolute':'0','direction':'EQUAL','unit':'%p'})
 def test_larger_claim(self):
  d=self.ok(request());self.assertEqual(d['computed_value'],'17.8');self.assertEqual(d['display_status'],'MISMATCH');self.assertEqual(d['difference'],{'signed':'5.2','absolute':'5.2','direction':'HIGHER','unit':'%p'})
 def test_smaller_claim(self):
  d=self.ok(request('15'));self.assertEqual(d['difference']['signed'],'-2.8');self.assertEqual(d['difference']['direction'],'LOWER')
 def test_tolerance_boundary_inclusive_not_exact(self):
  d=self.ok(request('17.9','0.1'));self.assertEqual(d['display_status'],'WITHIN_TOLERANCE');self.assertEqual(d['difference']['absolute'],'0.1')
 def test_outside_tolerance(self):self.assertEqual(self.ok(request('17.900001','0.1'))['display_status'],'MISMATCH')
 def test_exact_still_exact_with_nonzero_tolerance(self):self.assertEqual(self.ok(request('17.8','1'))['display_status'],'EXACT_MATCH')
 def test_absolute_units_for_sum(self):
  d=self.ok(request('2200',calc=calculation(operation='sum')));self.assertEqual(d['difference']['absolute'],'22');self.assertEqual(d['difference']['unit'],'명')
 def test_zero_result_needs_no_division(self):
  d=self.ok(request('1',calc=calculation('수치\n0'.encode(),operation='sum')));self.assertEqual(d['difference']['absolute'],'1')
 def test_negative_result_direction(self):
  d=self.ok(request('-2',calc=calculation('수치\n-5'.encode(),operation='sum')));self.assertEqual(d['difference']['signed'],'3');self.assertEqual(d['difference']['direction'],'HIGHER')
 def test_decimal_precision(self):
  d=self.ok(request('0.3',calc=calculation('수치\n0.1\n0.2'.encode(),operation='sum')));self.assertEqual(d['display_status'],'EXACT_MATCH')
 def test_grouping_and_input_spelling_preserved(self):
  p=request('2,178.00',calc=calculation(operation='sum'));d=self.ok(p);self.assertEqual(d['claim_value'],'2178');self.assertEqual(d['claim_input'],'2,178.00')
 def test_repeating_mean_with_explicit_tolerance(self):
  calc=calculation('수치\n1\n0\n0'.encode(),operation='mean')
  self.assertEqual(self.ok(request('0.333333','0',calc))['display_status'],'MISMATCH')
  self.assertEqual(self.ok(request('0.333333','0.000001',calc))['display_status'],'WITHIN_TOLERANCE')
 def test_wrong_calculation_and_dataset_cannot_borrow(self):
  for field in ['expected_dataset_version','expected_calculation_id']:
   p=request();p[field]='0'*64;self.error(p,'CALCULATION_LINKAGE_MISMATCH')
 def test_changed_csv_and_spec_fail_linkage(self):
  p=request();p['calculation']=calculation(operation='sum');self.error(p,'CALCULATION_LINKAGE_MISMATCH')
 def test_mismatched_unit(self):
  p=request();p['claim_unit']='명';self.error(p,'UNIT_NOT_CONFIRMED_OR_MISMATCH')
 def test_source_and_preview_still_rechecked(self):
  for field,code in [('source_sha256','SOURCE_MISMATCH'),('preview_sha256','PREVIEW_INTERPRETATION_MISMATCH')]:
   p=request();p['calculation'][field]='0'*64;self.error(p,code)
 def test_invalid_numbers_and_tolerances(self):
  for value in ['', '23%', '=2+2','NaN','1e3','0.0000001',True,None]:
   p=request();p['claim_value']=value;self.assertFalse(calculate_request(p)['ok'])
  for value in ['-1','1000000000000000001',None,'NaN']:
   p=request();p['tolerance_absolute']=value;self.assertFalse(calculate_request(p)['ok'])
 def test_no_client_computed_result_or_unknown_fields(self):
  p=request();p['computed_value']='23';self.error(p,'INVALID_REQUEST')
  p=request();p['calculation']={'mode':'compare'};self.error(p,'INVALID_REQUEST')
 def test_does_not_mutate_input_and_is_deterministic(self):
  p=request();saved=copy.deepcopy(p);self.assertEqual(self.ok(p),self.ok(p));self.assertEqual(p,saved)
 def test_no_network_and_existing_core_verifier_used(self):
  from when2warn.statguard.core import verify_numeric_claim
  with patch.object(socket,'socket',side_effect=AssertionError('NO_NETWORK')),patch('when2warn.statguard.local_bridge.verify_numeric_claim',wraps=verify_numeric_claim) as verify:
   self.ok(request());verify.assert_called_once()
 def test_exception_has_no_input_echo(self):
  p=request()
  with patch('when2warn.statguard.local_bridge.verify_numeric_claim',side_effect=RuntimeError('SYNTHETIC_PRIVATE_MARKER')):
   text=json.dumps(calculate_request(p));self.assertNotIn('SYNTHETIC_PRIVATE_MARKER',text)

if __name__=='__main__':unittest.main()
