import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectLexmark, LEXMARK_SITEMAP, lexmarkSource, parseLexmarkPage } from '../src/collectors/lexmark.js';
import { CartridgeDatabase } from '../src/database.js';
import { importCompatibilityRecords } from '../src/compatibility-importer.js';

const url = 'https://www.lexmark.com/es_es/printers/printer/90000/Lexmark-SYNTHETIC-100';
const date = '2026-10-13T12:00:00.000Z';
const directories: string[] = [];
const html = () => readFile('tests/fixtures/lexmark-synthetic.html', 'utf8');
const sitemap = () => readFile('tests/fixtures/lexmark-sitemap-synthetic.xml', 'utf8');
afterEach(async()=>{await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})))});

describe('Lexmark España collector — synthetic non-production fixtures',()=>{
  it('discovers only exact official printer pages from the sitemap',async()=>{
    const result=parseLexmarkPage(await sitemap(),LEXMARK_SITEMAP,date);
    expect(result.links).toEqual([url]); expect(result.records).toEqual([]); expect(result.review).toEqual([]);
  });
  it('emits verified OEM cartridges from return and standard tables only',async()=>{
    const result=parseLexmarkPage(await html(),url,date);
    expect(result.review).toEqual([]); expect(result.excluded).toEqual([expect.objectContaining({reason:'non-cartridge-category',detail:expect.stringContaining('SYN100D')})]); expect(result.records).toHaveLength(3);
    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({printerModel:'SYNTHETIC-100',cartridgePartNumber:'SYN100K',cartridgeKind:'toner',cartridgeColor:'black',yieldPages:5000,region:'ES',verificationStatus:'verified'}),
      expect.objectContaining({cartridgePartNumber:'SYN100C',cartridgeKind:'toner',cartridgeColor:'cyan',yieldPages:4000}),
      expect.objectContaining({cartridgePartNumber:'SYN100M',cartridgeColor:'magenta'}),
    ]));
    expect(result.records.every(record=>record.evidence?.includes('supplyTable'))).toBe(true);
  });
  it('fails closed for foreign URLs, row identity mismatch, uncertain types and access challenges',async()=>{
    expect(lexmarkSource(url.replace('www.lexmark.com','lexmark.example.invalid'))).toBeUndefined();
    expect(lexmarkSource(`${url}?page=1`)).toBeUndefined();
    const fixture=await html();
    expect(parseLexmarkPage(fixture.replace('<td>SYN100K</td>','<td>OTHER</td>'),url,date).review).toEqual(expect.arrayContaining([expect.objectContaining({reason:'invalid-cartridge-row'})]));
    expect(parseLexmarkPage(fixture.replaceAll('Cartucho de tóner','Cartucho desconocido').replace('Cartucho de impresión','Cartucho desconocido'),url,date).records).toEqual([]);
    expect(parseLexmarkPage('<title>Access denied</title>',url,date).review[0].reason).toBe('access-challenge');
  });
  it('passes records through the strict shared importer idempotently',async()=>{
    const records=parseLexmarkPage(await html(),url,date).records; const database=new CartridgeDatabase(':memory:');database.initialize();
    try{expect(importCompatibilityRecords(database,records,true)).toMatchObject({acceptedRecords:3,rejectedRecords:0});expect(database.list('printers')).toHaveLength(0);expect(importCompatibilityRecords(database,records,false).insertedRelationships).toBe(3);expect(importCompatibilityRecords(database,records,false).existingRelationships).toBe(3)}finally{database.close()}
  });
  it('collects the sitemap and a product page, then resumes without duplicate requests',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'lexmark-'));directories.push(directory);
    const options={outputDirectory:directory,stateFile:join(directory,'state.json'),maxPages:2,retries:0,delayMs:1000};let requests=0;
    const fetcher:typeof fetch=async target=>{requests++;const value=String(target);if(value.endsWith('/robots.txt'))return new Response('User-agent: *\nDisallow: /apps\n');if(value.endsWith('sitemap.xml'))return new Response(await sitemap());return new Response(await html())};
    const runtime={fetcher,now:()=>new Date(date),sleep:async()=>{}};
    expect(await collectLexmark(options,runtime)).toMatchObject({completedPages:2,pendingPages:0,printers:1,cartridges:3,relationships:3,failures:[]});
    const before=requests;expect(await collectLexmark(options,runtime)).toMatchObject({resumed:true,pagesVisited:0,requestAttempts:0,relationships:3});expect(requests).toBe(before);
  });
});
