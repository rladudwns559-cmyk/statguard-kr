import {afterEach,it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {cloudCalculation,localCalculationAvailable,calculationEndpoint,calculationClientHeader,calculateLocal,type CalculationRequest} from '../statguard/calculationClient';
import StatGuardWorkspace from '../statguard/StatGuardWorkspace';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('keeps loopback on the original local transport',()=>{
 vi.stubGlobal('location',{protocol:'http:',hostname:'127.0.0.1'});
 expect(cloudCalculation()).toBe(false);expect(localCalculationAvailable()).toBe(true);
 expect(calculationEndpoint()).toBe('/__statguard/calculate');expect(calculationClientHeader()).toBe('local-v0.1');
});
it('uses the same origin cloud endpoint on HTTPS',()=>{
 vi.stubGlobal('location',{protocol:'https:',hostname:'when2warn-public-beta.vercel.app'});
 expect(cloudCalculation()).toBe(true);expect(localCalculationAvailable()).toBe(true);
 expect(calculationEndpoint()).toBe('/api/statguard');expect(calculationClientHeader()).toBe('cloud-v0.1');
});
it('rejects plain HTTP remote execution',()=>{
 vi.stubGlobal('location',{protocol:'http:',hostname:'remote.invalid'});expect(localCalculationAvailable()).toBe(false);
});
it('shows cloud data transfer notice before any CSV is sent',()=>{
 vi.stubGlobal('location',{protocol:'https:',hostname:'when2warn-public-beta.vercel.app'});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);render(<StatGuardWorkspace/>);
 expect(screen.getByText('검증·계산할 때 CSV가 계산 서버로 전송됩니다.')).toBeVisible();
 expect(screen.getByText('온라인 계산')).toBeVisible();expect(screen.queryByText('CSV는 이 PC에서만 처리합니다.')).toBeNull();expect(fetch).not.toHaveBeenCalled();
 expect(document.querySelector('a[href="/demo"], a[href="/ask"], a[href="/projects"]')).toBeNull();
});
it('sends JSON without cookies or authorization to only the cloud calculation path',async()=>{
 vi.stubGlobal('location',{protocol:'https:',hostname:'when2warn-public-beta.vercel.app'});const fetch=vi.fn().mockResolvedValue({ok:false,json:async()=>({ok:false,error:{code:'ENGINE_BUSY'}})});vi.stubGlobal('fetch',fetch);
 await expect(calculateLocal({mode:'calculate'} as CalculationRequest,1,new AbortController().signal)).rejects.toThrow();
 const [url,options]=fetch.mock.calls[0];expect(url).toBe('/api/statguard');expect(options.credentials).toBe('omit');expect(options.redirect).toBe('error');expect(options.headers['X-StatGuard-Client']).toBe('cloud-v0.1');expect(options.headers.Authorization).toBeUndefined();expect(options.cache).toBe('no-store');
});
