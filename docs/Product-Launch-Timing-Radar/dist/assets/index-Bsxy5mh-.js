(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))t(n);new MutationObserver(n=>{for(const l of n)if(l.type==="childList")for(const r of l.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&t(r)}).observe(document,{childList:!0,subtree:!0});function a(n){const l={};return n.integrity&&(l.integrity=n.integrity),n.referrerPolicy&&(l.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?l.credentials="include":n.crossOrigin==="anonymous"?l.credentials="omit":l.credentials="same-origin",l}function t(n){if(n.ep)return;n.ep=!0;const l=a(n);fetch(n.href,l)}})();const d={settings:'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.39a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',check:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',alert:'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',xCircle:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',info:'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',plus:'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',trash:'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',calendar:'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>',bulb:'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>',book:'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',anchor:'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></svg>',factory:'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><line x1="17" y1="13" x2="17" y2="13.01"/><line x1="17" y1="17" x2="17" y2="17.01"/></svg>',star:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'},m=new Date().getFullYear(),W={sourcing:50,prod1:30,ship1:30,prep:25,test:15,prod2:30,ship2:45},L={2024:"2024-02-10",2025:"2025-01-29",2026:"2026-02-17",2027:"2027-02-06",2028:"2028-01-26",2029:"2029-02-13",2030:"2030-02-03",2031:"2031-01-23"},h=(s,e)=>{const a=new Date(s);return a.setDate(a.getDate()+e),a},j=s=>`${s.getFullYear()}-${(s.getMonth()+1).toString().padStart(2,"0")}-${s.getDate().toString().padStart(2,"0")}`,O=()=>{const s={},e=[m,m+1,m+2],a=25,t=15;return e.forEach(n=>{const l=L[n];if(l){const r=new Date(l);s[n]={factory:{start:j(h(r,-19)),end:j(h(r,a))},logistics:{start:j(h(r,-10)),end:j(h(r,t))}}}}),s};let o={config:{...W},cnyConfig:{customDates:O()},showConfig:!1,showRules:!1,productTypes:[{id:"1",name:"无季节常青款",type:"evergreen",peakMonths:[]},{id:"2",name:"冬季旺季 (11-12月)",type:"seasonal",peakMonths:[11,12]},{id:"3",name:"夏季旺季 (5-6月)",type:"seasonal",peakMonths:[5,6]},{id:"4",name:"返校季 (7-8月)",type:"seasonal",peakMonths:[7,8]},{id:"5",name:"情人节 (1-2月)",type:"seasonal",peakMonths:[1,2]},{id:"6",name:"复活节 (3-4月)",type:"seasonal",peakMonths:[3,4]},{id:"7",name:"万圣节 (9-10月)",type:"seasonal",peakMonths:[9,10]}],selectedTypeId:"1",selectedMonth:null,isAddingType:!1,newTypeName:"",newTypeSeason:"seasonal",newTypePeaks:[]};const R=(s,e)=>{const a=o.cnyConfig.customDates[s];if(!a)return null;const t=a[e];return t?{shutdown:new Date(t.start),resume:new Date(t.end)}:null},D=(s,e,a)=>{let t=new Date(s),n=!1;const l=[s.getFullYear(),s.getFullYear()+1];for(const x of l){const p=R(x,a);if(p&&s>p.shutdown&&s<p.resume){t=new Date(p.resume),n=!0;break}}let r=e,i=new Date(t);for(const x of[i.getFullYear(),i.getFullYear()+1]){const p=R(x,a);if(p)if(i<p.shutdown){const v=Math.ceil((p.shutdown.getTime()-i.getTime())/864e5);if(v<r)r-=v,i=new Date(p.resume),n=!0;else break}else i>=p.shutdown&&i<p.resume&&(i=new Date(p.resume),n=!0)}const c=h(i,r);return{start:t,end:c,delayed:n}},A=s=>`${(s.getMonth()+1).toString().padStart(2,"0")}/${s.getDate().toString().padStart(2,"0")}`,E=s=>`${s.getFullYear()}-${(s.getMonth()+1).toString().padStart(2,"0")}-${s.getDate().toString().padStart(2,"0")}`,S=s=>{const e=s.getMonth();return e===9||e===10},B=(s,e)=>{const a=new Date(m,s,1);let t="success",n,l="",r="",i,c=null,x="fail";const p=h(a,o.config.sourcing),v=D(p,o.config.prod1,"factory"),C=D(v.end,o.config.ship1,"logistics");let P=h(C.end,o.config.prep),w=new Date(P);if(w.getMonth()===11){const M=w.getFullYear()+1;w=new Date(M,0,1),c="推迟至1月启动 (避开12月)"}const N=h(w,o.config.test),k=D(N,o.config.prod2,"factory"),f=D(k.end,o.config.ship2,"logistics");if(e.type==="seasonal"){const b=(e.peakMonths||[])[0];let $=a.getFullYear();s+1>=b&&($+=1);const I=new Date($,b-1,1),F=h(I,20);if(f.end<=F){const Y=f.end>I;i={targetPeakMonth:b,arrivalMonth:f.end.getMonth()+1,arrivalDate:A(f.end),targetYear:I.getFullYear(),missed:!1,nearMiss:Y},S(w)&&(t="fail",n="推广期撞上Q4 (10-11月)，不接受等待",l="撞Q4不可等")}else t="fail",n=`赶不上${$}年${b}月旺季 (大货${A(f.end)}到仓)`,l="错过旺季",i={missed:!0,targetPeakMonth:b,targetYear:$,arrivalDate:A(f.end)}}else S(w)&&(t="fail",n="推广期撞上Q4 (10-11月)，不接受等待",l="撞Q4不可等");let T=[];if(t==="success"&&i&&i.nearMiss&&T.push("旺季延误(20天内)"),t==="success"&&((v.delayed||C.delayed)&&T.push("首批撞春节"),(k.delayed||f.delayed)&&T.push("补货撞春节")),T.length>0?r=T.join(" | "):r=null,t==="fail")x="fail";else if(r?x="warning":x="good",e.type==="seasonal"&&i&&!i.missed){const M=f.end.getMonth()+1,b=i.targetPeakMonth,$=b===1?12:b-1;(M===b||M===$)&&(x="perfect")}return{startMonth:s+1,status:t,grade:x,failReason:n,shortFailReason:l,cnyWarning:r,promoStrategy:c,delays:{prod1:v.delayed,ship1:C.delayed,prod2:k.delayed,ship2:f.delayed},dates:{start:a,sourcingEnd:p,prod1Start:v.start,prod1End:v.end,ship1End:C.end,prepEnd:P,promoStart:w,testEnd:N,prod2Start:k.start,prod2End:k.end,ship2End:f.end},peakInfo:i}},V=()=>{const s=o.productTypes.find(t=>t.id===o.selectedTypeId)||o.productTypes[0],e=[],a=[];for(let t=0;t<12;t++)e.push(B(t,s));for(let t=0;t<12;t++){const n={month:t+1,results:[]};o.productTypes.forEach(l=>{n.results.push({typeId:l.id,...B(t,l)})}),a.push(n)}return{currentResults:e,matrix:a}};function z(){return o.showRules?`
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onclick="toggleRules()">
            <div class="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden" onclick="event.stopPropagation()">
                <div class="px-6 py-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                    <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><span class="text-blue-600">${d.book}</span> 系统逻辑说明</h3>
                    <button onclick="toggleRules()" class="p-2 hover:bg-slate-200 rounded-full text-slate-500">${d.xCircle}</button>
                </div>
                <div class="p-6 md:p-8 space-y-6 text-slate-700 overflow-y-auto max-h-[80vh]">
                    <div class="flex gap-4">
                         <div class="flex-shrink-0 w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center font-bold">1</div>
                         <div>
                            <h4 class="font-bold text-slate-900 mb-1">优先级与否决条件 (Priority)</h4>
                            <ul class="text-sm text-slate-600 space-y-1">
                                <li><span class="text-rose-600 font-bold">1. 错过旺季</span>: 根据开品时间锁定最近一次旺季，若赶不上（>旺季开始+20天），直接否决。</li>
                                <li><span class="text-rose-600 font-bold">2. 撞Q4</span>: 推广期落在10月/11月，否决。</li>
                            </ul>
                        </div>
                    </div>
                    <div class="flex gap-4">
                        <div class="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">2</div>
                        <div>
                            <h4 class="font-bold text-slate-900 mb-1">旺季定标逻辑</h4>
                            <p class="text-sm text-slate-600">
                                若开品月份 < 旺季月份 ➔ 目标为<b>当年</b>旺季。<br>
                                若开品月份 ≥ 旺季月份 ➔ 目标为<b>次年</b>旺季。
                            </p>
                        </div>
                    </div>
                    <div class="flex gap-4">
                         <div class="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center font-bold">3</div>
                         <div>
                            <h4 class="font-bold text-slate-900 mb-1">推荐等级 (完美节奏)</h4>
                            <p class="text-sm text-slate-600">
                              <span class="text-indigo-600 font-bold">完美节奏</span>：补货到仓时间刚好卡在【旺季当月】或【旺季前1个月】，不早不晚，库存流转效率最高。
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `:""}function H(){if(!o.showConfig)return"";const s={sourcing:"选品/样品",prod1:"首批生产",ship1:"首批物流",prep:"上架准备",test:"推广测试",prod2:"补货生产",ship2:"补货物流"},e=[m,m+1,m+2],a=o.cnyConfig.customDates;return`
    <div class="bg-white p-6 rounded-2xl shadow-xl border border-slate-200 animate-fade-in mb-10 max-w-7xl mx-auto">
      <div class="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
        <h3 class="font-bold text-slate-800 flex items-center gap-2 text-base"><span class="text-blue-600">${d.settings}</span> 周期参数 (天)</h3>
        <button onclick="toggleConfig()" class="text-slate-400 hover:text-slate-600 p-2">${d.xCircle}</button>
      </div>
      
      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-6 mb-8">
        ${Object.entries(o.config).map(([t,n])=>`
           <div class="flex flex-col"><label class="text-xs text-slate-500 font-semibold mb-1.5">${s[t]}</label><input type="number" value="${n}" onchange="updateConfig('${t}', this.value)" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm font-mono shadow-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" /></div>
        `).join("")}
      </div>

      <div class="border-t border-slate-100 pt-6">
        <h3 class="font-bold text-slate-800 flex items-center gap-2 text-base mb-6"><span class="text-rose-600">${d.calendar}</span> 春节停工日期配置 (具体日期)</h3>
        <div class="overflow-x-auto">
            <table class="w-full text-sm text-left">
                <thead class="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                    <tr>
                        <th class="px-4 py-3">年份</th>
                        <th class="px-4 py-3 text-rose-600"><div class="flex items-center gap-1">${d.factory} 工厂停工开始</div></th>
                        <th class="px-4 py-3 text-rose-600"><div class="flex items-center gap-1">${d.factory} 工厂复工日期</div></th>
                        <th class="px-4 py-3 text-blue-600"><div class="flex items-center gap-1">${d.anchor} 物流停运开始</div></th>
                        <th class="px-4 py-3 text-blue-600"><div class="flex items-center gap-1">${d.anchor} 物流恢复日期</div></th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${e.map(t=>{const n=a[t]||{factory:{},logistics:{}};return`
                        <tr>
                            <td class="px-4 py-3 font-bold text-slate-700">${t}</td>
                            <td class="px-4 py-2"><input type="date" value="${n.factory.start}" onchange="updateCustomDate(${t}, 'factory', 'start', this.value)" class="p-2 border border-slate-200 rounded text-xs font-mono w-36 focus:ring-2 focus:ring-rose-500 outline-none"/></td>
                            <td class="px-4 py-2"><input type="date" value="${n.factory.end}" onchange="updateCustomDate(${t}, 'factory', 'end', this.value)" class="p-2 border border-slate-200 rounded text-xs font-mono w-36 focus:ring-2 focus:ring-rose-500 outline-none"/></td>
                            <td class="px-4 py-2"><input type="date" value="${n.logistics.start}" onchange="updateCustomDate(${t}, 'logistics', 'start', this.value)" class="p-2 border border-slate-200 rounded text-xs font-mono w-36 focus:ring-2 focus:ring-blue-500 outline-none"/></td>
                            <td class="px-4 py-2"><input type="date" value="${n.logistics.end}" onchange="updateCustomDate(${t}, 'logistics', 'end', this.value)" class="p-2 border border-slate-200 rounded text-xs font-mono w-36 focus:ring-2 focus:ring-blue-500 outline-none"/></td>
                        </tr>
                        `}).join("")}
                </tbody>
            </table>
        </div>
      </div>
    </div>
  `}function Q(s,e){return`
      <div class="mb-12 max-w-[1400px] mx-auto">
        <div class="flex items-start gap-4 p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl mb-8 text-slate-700 shadow-sm">
            <div class="text-blue-500 mt-1">${d.bulb}</div>
            <div class="flex-1">
                <p class="font-bold text-blue-900 mb-2 text-lg">年度开品策略建议</p>
                <div class="space-y-1 text-sm md:text-base leading-relaxed">
                    <p>黄金窗口：<span class="font-black text-blue-700 text-lg">${e.best}</span>。</p>
                </div>
            </div>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
            <div class="px-6 py-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center flex-wrap gap-4">
                <h3 class="font-bold text-slate-800 text-lg">📅 ${m} 全景沙盘</h3>
                <div class="flex gap-4 text-xs font-medium flex-wrap">
                    <div class="flex items-center gap-1.5"><span class="w-4 h-4 rounded bg-indigo-50 border border-indigo-300 text-indigo-600 flex items-center justify-center shadow-sm"><span class="scale-75">${d.star}</span></span> 完美节奏</div>
                    <div class="flex items-center gap-1.5"><span class="w-4 h-4 rounded bg-white border border-emerald-400 flex items-center justify-center text-[10px] text-emerald-600 shadow-sm">${d.check}</span> 推荐</div>
                    <div class="flex items-center gap-1.5"><span class="w-4 h-4 rounded bg-white border border-emerald-400 flex items-center justify-center text-[10px] text-amber-600 shadow-sm">${d.check}</span> 推荐(有延误)</div>
                    <div class="flex items-center gap-1.5"><span class="w-4 h-4 rounded bg-slate-100 border border-slate-300"></span> 不可行</div>
                </div>
            </div>
            <div class="overflow-x-auto pb-2">
                <table class="w-full text-sm text-left border-collapse">
                    <thead class="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-100">
                        <tr><th class="px-4 py-4 font-bold w-16 text-center border-r border-slate-100 bg-slate-100/50 sticky left-0 z-10">开品</th>${o.productTypes.map(a=>{var t;return`<th class="px-3 py-4 font-bold text-center border-r border-slate-100"><div class="text-slate-800 text-sm">${a.name.split(" ")[0]}</div><div class="text-[10px] text-slate-400">${((t=a.name.match(/\(.*\)/))==null?void 0:t[0])||"全年"}</div></th>`}).join("")}</tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${s.map(a=>`
                            <tr class="hover:bg-slate-50 transition-colors group">
                                <td class="px-4 py-3 font-bold text-slate-700 text-center bg-slate-50/50 border-r border-slate-100 sticky left-0 z-10">${a.month}月</td>
                                ${a.results.map(t=>{let n="",l="";const r=o.selectedTypeId===t.typeId&&o.selectedMonth===a.month;if(t.grade==="fail")l="bg-slate-100 text-slate-500 border-slate-200 hover:border-slate-300",n=`<span class="font-bold text-[10px] whitespace-nowrap scale-90 block text-center text-slate-500">${t.shortFailReason}</span>`;else if(t.grade==="perfect")l="bg-gradient-to-br from-indigo-50 to-purple-50 text-indigo-700 border-indigo-300 shadow-sm hover:border-indigo-400 ring-1 ring-transparent hover:ring-indigo-200",n=`<span class="flex items-center justify-center gap-0.5 font-bold"><span class="scale-75 text-indigo-500 fill-indigo-500">${d.star}</span> <span class="hidden lg:inline text-[10px]">完美</span></span>`;else if(t.grade==="good")l="bg-white text-emerald-700 border-emerald-400 shadow-sm hover:border-emerald-500",n=`<span class="flex items-center justify-center gap-1 font-bold">${d.check} <span class="hidden lg:inline">推荐</span></span>`;else if(t.grade==="warning"){l="bg-white text-emerald-700 border-emerald-400 shadow-sm hover:border-emerald-500";let i="延误";t.cnyWarning.includes("首批")&&t.cnyWarning.includes("补货")?i="双重延误":t.cnyWarning.includes("旺季")?i="旺季延误":t.cnyWarning.includes("首批")?i="首批春节":t.cnyWarning.includes("补货")&&(i="补货春节"),n=`<div class="flex flex-col items-center justify-center gap-0.5 w-full"><div class="text-emerald-500">${d.check}</div><span class="text-[10px] font-bold text-amber-600 whitespace-nowrap scale-90">${i}</span></div>`}return`<td class="p-2 border-r border-slate-100 h-16"><div onclick="selectTypeAndMonth('${t.typeId}', ${a.month})" class="cursor-pointer rounded-lg h-full w-full flex items-center justify-center transition-all border ${l} ${r?"ring-2 ring-inset ring-blue-500 z-10":""}">${n}</div></td>`}).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        </div>
      </div>
    `}function _(s){return`
      <div class="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8 max-w-[1400px] mx-auto px-4 md:px-0">
        ${s.map(e=>{const a=o.selectedMonth===e.startMonth;let t="",n="",l="",r="",i="",c="";return e.grade==="fail"?(t="border-slate-200 hover:border-blue-300",n="bg-slate-50",l=d.xCircle,r="text-slate-400",i="text-slate-500",c="不可行"):e.grade==="perfect"?(t="border-indigo-200 hover:border-indigo-400",n="bg-gradient-to-br from-indigo-50 to-white",l=`<span class="fill-indigo-500 text-indigo-500">${d.star}</span>`,r="text-indigo-500",i="text-indigo-700",c="完美节奏"):e.grade==="good"?(t="border-slate-200 hover:border-blue-300",n="bg-white",l=d.check,r="text-emerald-500",i="text-emerald-700",c="推荐"):e.grade==="warning"&&(t="border-slate-200 hover:border-blue-300",n="bg-white",l=d.check,r="text-emerald-500",i="text-amber-600",e.cnyWarning.includes("旺季")?c="旺季延误":e.cnyWarning.includes("首批")&&e.cnyWarning.includes("补货")?c="双重延误":e.cnyWarning.includes("首批")?c="首批春节":e.cnyWarning.includes("补货")?c="补货春节":c="有延误"),a&&(t="border-blue-600 ring-2 ring-blue-100"),`
                <button onclick="selectMonth(${e.startMonth})" class="flex flex-col items-center p-4 rounded-xl border transition-all shadow-sm ${t} ${n}">
                    <div class="text-lg font-black text-slate-700 mb-2">${e.startMonth}月</div>
                    <div class="${r} mb-2">${l}</div>
                    <div class="text-xs font-bold ${i}">${c}</div>
                    ${e.grade==="fail"?`<div class="text-[10px] text-slate-500 font-medium mt-1 truncate w-full text-center">${e.shortFailReason}</div>`:""}
                </button>
             `}).join("")}
      </div>
    `}function G(s){if(!o.selectedMonth)return"";const e=s.find(n=>n.startMonth===o.selectedMonth);if(!e)return"";let a="",t="";return e.grade==="fail"?(a="from-slate-100 to-slate-200 border-slate-200 text-slate-600",t="不建议开品"):e.grade==="perfect"?(a="from-indigo-100 to-purple-100 border-indigo-200 text-indigo-800",t="完美开品节奏"):e.grade==="warning"?(a="from-yellow-50 to-orange-50 border-orange-200 text-orange-800",t="可行但有延误"):(a="from-emerald-50 to-teal-50 border-emerald-200 text-emerald-800",t="推荐开品"),`
    <div id="detail-view" class="bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-fade-in mt-4 mb-20 max-w-[1400px] mx-auto">
      <div class="px-8 py-6 border-b flex justify-between items-center bg-gradient-to-r ${a}">
        <div>
          <h2 class="text-2xl font-black flex items-center gap-3">
             ${e.startMonth}月开品推演 
             <span class="text-xs px-3 py-1 rounded-full border border-current bg-white/50 uppercase tracking-widest font-bold shadow-sm flex items-center gap-1">
                ${e.grade==="perfect"?`<span class="text-indigo-600 fill-indigo-600 scale-75">${d.star}</span>`:""} ${t}
             </span>
          </h2>
          ${e.failReason?`<p class="text-sm font-bold mt-2 flex items-center gap-2"><span class="bg-black/10 p-1 rounded text-[10px]">${d.xCircle}</span> ${e.failReason}</p>`:""}
          ${e.cnyWarning?`<p class="text-sm font-bold mt-2 flex items-center gap-2"><span class="bg-black/10 p-1 rounded text-[10px]">${d.alert}</span> ${e.cnyWarning}</p>`:""}
        </div>
        <button onclick="selectMonth(null)" class="p-2 hover:bg-black/10 rounded-full">${d.xCircle}</button>
      </div>
      <div class="p-8 bg-slate-50/50">
        <div class="grid lg:grid-cols-2 gap-12">
            <div>
              <h3 class="text-xs font-extrabold text-slate-400 uppercase mb-6 tracking-widest">第一阶段: 首批测试</h3>
              ${y("选品/样品",e.dates.start,e.dates.sourcingEnd,o.config.sourcing,1)}
              ${y("首批生产",e.dates.prod1Start,e.dates.prod1End,o.config.prod1,2,!1,e.delays.prod1?"春节延误":null)}
              ${y("首批物流",e.dates.prod1End,e.dates.ship1End,o.config.ship1,3,!1,e.delays.ship1?"春节延误":null)}
              ${y("上架准备",e.dates.ship1End,e.dates.prepEnd,o.config.prep,4)}
            </div>
            <div>
              <h3 class="text-xs font-extrabold text-slate-400 uppercase mb-6 tracking-widest">第二阶段: 推广与返单</h3>
              <div class="pl-5 py-4 mb-6 relative group">
                 <div class="absolute left-0 top-0 bottom-0 w-1.5 rounded-full bg-blue-300"></div>
                 <div class="p-5 rounded-2xl border-2 shadow-sm bg-white ${S(e.dates.promoStart)?"border-rose-300":"border-blue-400"}">
                    <div class="text-xs font-bold text-slate-400 uppercase mb-2">推广启动</div>
                    <div class="text-3xl font-black text-slate-800 font-mono">${E(e.dates.promoStart)}</div>
                    ${e.promoStrategy?`<div class="text-indigo-600 text-xs font-bold mt-2 flex items-center gap-1">${d.bulb} ${e.promoStrategy}</div>`:""}
                    ${S(e.dates.promoStart)?`<div class="text-rose-600 text-xs font-bold mt-2">${d.alert} Q4流量期</div>`:""}
                 </div>
              </div>
              ${y("推广测试期",e.dates.promoStart,e.dates.testEnd,o.config.test,5)}
              ${y("补货生产",e.dates.prod2Start,e.dates.prod2End,o.config.prod2,6,!1,e.delays.prod2?"春节延误":null)}
              ${y("补货物流",e.dates.prod2End,e.dates.ship2End,o.config.ship2,7,!0,e.delays.ship2?"春节延误":null)}
              
              ${e.peakInfo?`
                <div class="mt-8 p-5 rounded-2xl border-2 border-dashed ${e.grade==="perfect"?"bg-indigo-50 border-indigo-300 ring-2 ring-indigo-100":!e.peakInfo.missed&&!e.peakInfo.nearMiss?"bg-emerald-50 border-emerald-300":e.peakInfo.nearMiss?"bg-amber-50 border-amber-300":"bg-slate-100 border-slate-300"}">
                  <h4 class="font-bold text-sm mb-4 text-slate-800 uppercase flex items-center gap-2">${d.bulb} 旺季匹配 (Targeting)</h4>
                  <div class="text-sm mb-2 text-slate-500">大货到仓: <span class="font-bold text-slate-800">${e.peakInfo.arrivalDate}</span></div>
                  <div class="text-sm mb-4 text-slate-500">赶上面向: <span class="font-bold text-slate-800">${e.peakInfo.targetYear}年${e.peakInfo.targetPeakMonth}月旺季</span></div>
                  <div class="text-sm font-bold flex items-center gap-2 p-2 rounded-lg ${e.peakInfo.missed?"bg-slate-200 text-slate-500":e.grade==="perfect"?"bg-indigo-100 text-indigo-700":e.peakInfo.nearMiss?"bg-amber-100 text-amber-700":"bg-emerald-100 text-emerald-700"}">
                    ${e.grade==="perfect"?d.star:e.peakInfo.missed?d.xCircle:e.peakInfo.nearMiss?d.alert:d.check} 
                    ${e.grade==="perfect"?"完美节奏 (正值旺季/旺季前夕)":e.peakInfo.missed?"错失旺季":e.peakInfo.nearMiss?"延误但可行 (20天内)":"匹配成功"}
                  </div>
                </div>
              `:""}
            </div>
        </div>
      </div>
    </div>
  `}function y(s,e,a,t,n,l=!1,r=null,i=!1){const c=Math.ceil(Math.abs(a.getTime()-e.getTime())/864e5),x=c>t+5;return`
    <div class="relative flex gap-5 group">
      ${l?"":'<div class="absolute left-[18px] top-10 bottom-[-24px] w-[2px] bg-slate-100"></div>'}
      <div class="z-10 flex-shrink-0 pt-1"><div class="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm border ring-2 ring-slate-50 ${i?"bg-slate-200 text-slate-500":x||r?"bg-amber-100 text-amber-600":"bg-slate-100 text-slate-500"}">${n}</div></div>
      <div class="flex-grow p-4 rounded-xl border shadow-sm mb-4 bg-white border-slate-200">
        <div class="flex justify-between items-center mb-1"><h4 class="font-bold text-slate-800">${s}</h4><span class="text-xs font-mono bg-slate-50 px-2 py-1 rounded border">${E(e)} ➔ ${E(a)}</span></div>
        <div class="flex gap-4 text-xs text-slate-500 mt-2"><span>计划: ${t}天</span>${x?`<span class="text-amber-700 font-bold">实际: ${c}天</span>`:""}</div>
        ${r?`<div class="mt-3 text-xs font-bold flex items-center gap-1.5 p-2 rounded bg-amber-50 text-amber-700">${d.alert} ${r}</div>`:""}
      </div>
    </div>
  `}function g(){const{currentResults:s,matrix:e}=V(),a=o.productTypes.find(l=>l.id===o.selectedTypeId)||o.productTypes[0],t=U(e),n=Z(s,a.name);document.getElementById("app").innerHTML=`
    <div class="max-w-[1600px] mx-auto pb-24 px-4 sm:px-6 lg:px-8">
      ${z()}
      <header class="mb-12 pt-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-slate-200 pb-8">
        <div>
            <h1 class="text-3xl md:text-5xl font-extrabold text-slate-900 tracking-tight flex items-center gap-4">
               <span class="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">Amazon Launch Planner</span>
               <span class="px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-xs font-mono font-bold border border-slate-200 uppercase tracking-wider">${m}</span>
            </h1>
            <p class="text-slate-500 text-base md:text-lg mt-3 font-medium">全年度、多类型亚马逊新品开发倒推与排期系统</p>
        </div>
        <div class="flex gap-3">
            <button onclick="toggleRules()" class="flex items-center gap-2 text-slate-600 hover:text-blue-600 bg-white border border-slate-200 hover:bg-blue-50 px-5 py-3 rounded-xl text-sm font-bold shadow-sm">${d.book} <span class="hidden md:inline">逻辑说明</span></button>
            <button onclick="toggleConfig()" class="flex items-center gap-2 text-slate-600 hover:text-blue-600 bg-white border border-slate-200 hover:bg-blue-50 px-5 py-3 rounded-xl text-sm font-bold shadow-sm">${d.settings} 配置</button>
        </div>
      </header>
      ${H()}
      ${Q(e,t)}
      
      <div class="mb-8 max-w-[1400px] mx-auto">
        <div class="flex justify-between items-end mb-4 px-1"><h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><span class="w-1.5 h-6 bg-blue-600 rounded-full"></span> 按类型详情</h3><button onclick="toggleAddType()" class="text-sm flex items-center gap-1 text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors font-medium">${d.plus} 新类型</button></div>
        <div class="flex overflow-x-auto gap-3 pb-4 scrollbar-hide mb-2">
            ${o.productTypes.map(l=>`<button onclick="selectType('${l.id}')" class="whitespace-nowrap px-5 py-3 rounded-xl text-sm font-bold transition-all border flex items-center gap-2 ${o.selectedTypeId===l.id?"bg-slate-800 border-slate-800 text-white shadow-lg":"bg-white border-slate-200 text-slate-500 hover:bg-slate-50"}">${l.name.split(" ")[0]} ${["1","2","3","4","5","6","7"].includes(l.id)?"":`<span onclick="event.stopPropagation(); deleteType('${l.id}')" class="opacity-50 hover:text-rose-400 ml-1">${d.trash}</span>`}</button>`).join("")}
        </div>
        <div class="p-4 bg-white rounded-xl shadow-sm border border-slate-200 flex gap-4 items-start"><div class="text-blue-500 mt-0.5 bg-blue-50 p-2 rounded-lg">${d.info}</div><div class="leading-relaxed text-slate-700 text-sm md:text-base">${n}</div></div>
        ${o.isAddingType?`
            <div class="mt-4 p-6 bg-white rounded-2xl border border-blue-100 shadow-xl max-w-2xl"><h4 class="font-bold text-slate-800 mb-4">添加新类型</h4><div class="flex gap-4 mb-4"><input id="newTypeName" type="text" placeholder="输入名称..." class="flex-1 p-3 border border-slate-200 rounded-xl text-sm" value="${o.newTypeName}" oninput="updateNewTypeName(this.value)"><select onchange="updateNewTypeSeason(this.value)" class="p-3 border border-slate-200 rounded-xl text-sm"><option value="seasonal">季节性</option><option value="evergreen">常青款</option></select></div>${o.newTypeSeason==="seasonal"?`<div class="mb-6"><p class="text-sm font-semibold text-slate-700 mb-3">旺季月份:</p><div class="flex flex-wrap gap-2">${Array.from({length:12},(l,r)=>r+1).map(l=>`<button onclick="toggleNewPeak(${l})" class="w-10 h-10 rounded-lg text-sm font-bold border-2 ${o.newTypePeaks.includes(l)?"bg-blue-600 text-white border-blue-600":"bg-slate-50 text-slate-400"}" >${l}</button>`).join("")}</div></div>`:""}<div class="flex justify-end gap-3"><button onclick="toggleAddType()" class="px-5 py-2 text-sm text-slate-500">取消</button><button onclick="confirmAddType()" class="px-5 py-2 text-sm font-bold bg-blue-600 text-white rounded-xl">确认</button></div></div>
        `:""}
      </div>

      ${_(s)}
      ${G(s)}
      <footer class="text-center text-slate-400 text-xs mt-16 border-t border-slate-100 pt-8 pb-8">System optimized for supply chain speed & seasonality.</footer>
    </div>
  `}const u=window;u.toggleRules=()=>{o.showRules=!o.showRules,g()};u.toggleConfig=()=>{o.showConfig=!o.showConfig,g()};u.updateConfig=(s,e)=>{o.config[s]=parseInt(e)||0,g()};u.updateCustomDate=(s,e,a,t)=>{o.cnyConfig.customDates[s]||(o.cnyConfig.customDates[s]={factory:{},logistics:{}}),o.cnyConfig.customDates[s][e][a]=t,g()};u.selectType=s=>{o.selectedTypeId=s,o.selectedMonth=null,g()};u.selectTypeAndMonth=(s,e)=>{o.selectedTypeId=s,o.selectedMonth=e,g(),setTimeout(()=>{var a;return(a=document.getElementById("detail-view"))==null?void 0:a.scrollIntoView({behavior:"smooth",block:"center"})},100)};u.toggleAddType=()=>{o.isAddingType=!o.isAddingType,o.newTypeName="",o.newTypeSeason="seasonal",o.newTypePeaks=[],g()};u.updateNewTypeName=s=>o.newTypeName=s;u.updateNewTypeSeason=s=>{o.newTypeSeason=s,g()};u.toggleNewPeak=s=>{o.newTypePeaks.includes(s)?o.newTypePeaks=o.newTypePeaks.filter(e=>e!==s):o.newTypePeaks.push(s),g()};u.confirmAddType=()=>{if(!o.newTypeName)return;const s=Date.now().toString();o.productTypes.push({id:s,name:o.newTypeName,type:o.newTypeSeason,peakMonths:o.newTypeSeason==="seasonal"?o.newTypePeaks:[]}),o.isAddingType=!1,o.selectedTypeId=s,g()};u.deleteType=s=>{o.productTypes=o.productTypes.filter(e=>e.id!==s),o.selectedTypeId===s&&(o.selectedTypeId=o.productTypes[0].id),g()};u.selectMonth=s=>{o.selectedMonth=s,g(),s&&setTimeout(()=>{var e;return(e=document.getElementById("detail-view"))==null?void 0:e.scrollIntoView({behavior:"smooth",block:"center"})},50)};function U(s){return{best:s.map(n=>{const l=n.results.filter(i=>i.status==="success").length,r=n.results.filter(i=>i.status==="success"&&i.cnyWarning).length;return l-r*.2}).map((n,l)=>({m:l+1,s:n})).sort((n,l)=>l.s-n.s).filter(n=>n.s>0).slice(0,3).map(n=>n.m+"月").join("、")||"无理想月份"}}function Z(s,e){const a=s.filter(r=>r.grade==="perfect").map(r=>r.startMonth),t=s.filter(r=>r.grade==="good").map(r=>r.startMonth),n=s.filter(r=>r.grade==="warning").map(r=>r.startMonth);if(!a.length&&!t.length&&!n.length)return'<span class="text-rose-600 font-bold">⚠️ 全年无解 (需提速或接受长周期)</span>';let l=`对于 <b>${e}</b>`;return a.length?l+=`，<span class="text-indigo-600 font-bold">👑 完美月份：${a.join("、")}月</span>`:l+=`，最佳月份：<span class="text-emerald-600 font-bold">${t.join("、")}月</span>`,a.length&&t.length&&(l+=`，普通推荐：${t.join("、")}月`),n.length&&(l+=`，可行(有延误)：<span class="text-amber-600 font-bold">${n.join("、")}月</span>`),l+"。"}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",g):g();
