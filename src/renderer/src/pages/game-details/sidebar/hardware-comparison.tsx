import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/button/button";
import { SidebarSection } from "../sidebar-section/sidebar-section";
export function HardwareComparison({ requirements }: { requirements?: string }) {
  const { i18n } = useTranslation();
  const pl = i18n.language.startsWith("pl");
  const [hardware,setHardware] = useState<{ramBytes:number;cpu:string;logicalCores:number}>();
  const [failed,setFailed] = useState(false);
  const text = (requirements ?? "").replace(/<[^>]*>/g," ");
  const match = /(?:memory|ram|pamięć)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(GB|MB)\b/i.exec(text);
  const required = match ? Number(match[1].replace(",",".")) * (match[2].toUpperCase()==="GB"?1024:1) : null;
  return <SidebarSection title={pl?"Porównanie sprzętu":"Hardware comparison"}>
    <Button theme="outline" size="small" onClick={()=>{setFailed(false);window.electron.getKrystaHardware().then(setHardware).catch(()=>setFailed(true));}}>{pl?"Sprawdź komputer":"Check computer"}</Button>
    {failed && <p>{pl?"Nie udało się odczytać sprzętu":"Hardware unavailable"}</p>}
    {hardware && <div><p>CPU: {hardware.cpu} ({hardware.logicalCores})</p><p>RAM: {(hardware.ramBytes/1073741824).toFixed(1)} GB</p><p>{required === null ? (pl?"Brak jednoznacznego wymagania RAM":"RAM requirement unknown") : hardware.ramBytes/1048576 >= required ? (pl?"RAM spełnia podane wymaganie":"RAM meets listed requirement") : (pl?"RAM poniżej podanego wymagania":"RAM below listed requirement")}</p><small>{pl?"CPU i GPU nie są automatycznie oceniane. To nie gwarancja działania gry.":"CPU and GPU are not automatically rated. This does not guarantee compatibility."}</small></div>}
  </SidebarSection>;
}
