import { fetchLatestAsicShortReport } from "@/lib/asicShort";
import { fetchFcaFirdsUniverse, fetchFirdsUniverse, fetchHkexUniverse, fetchJquantsUniverse, fetchTwseUniverse } from "@/lib/officialUniverses";
import { recordProviderFailure, recordProviderSuccess, shouldSkipProviderFetch, universeProviderForMarket } from "@/lib/providerRuntimeStatus";
import { envValue } from "@/lib/env";

const FIRDS_MARKETS = new Set(["AT", "BE", "DE", "DK", "ES", "FI", "FR", "IE", "IT", "NL", "NO", "PT", "SE"]);

function envNumber(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(envValue(name) || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export const CURATED = {
  ES: ["IBE.MC", "ITX.MC", "AMS.MC", "SAN.MC", "BBVA.MC", "AENA.MC", "GRF.MC", "FER.MC", "CABK.MC", "CLNX.MC", "ELE.MC", "NTGY.MC", "REP.MC", "TEF.MC", "MRL.MC", "ROVI.MC", "LOG.MC"],
  DE: ["SAP.DE", "SIE.DE", "RHM.DE", "ALV.DE", "DTE.DE", "MBG.DE", "BMW.DE", "ADS.DE", "IFX.DE", "DHER.DE", "HNR1.DE", "ENR.DE", "SHL.DE", "BEI.DE", "AFX.DE"],
  FR: ["HO.PA", "SAF.PA", "SU.PA", "AI.PA", "OR.PA", "MC.PA", "TTE.PA", "CAP.PA", "DSY.PA", "RMS.PA", "AIR.PA", "STMPA.PA", "VIE.PA", "RI.PA"],
  NL: ["ASML.AS", "ASM.AS", "BESI.AS", "ADYEN.AS", "PRX.AS", "INGA.AS", "WKL.AS", "PHIA.AS", "HEIA.AS", "UMG.AS"],
  GB: ["RR.L", "BA.L", "SHEL.L", "AZN.L", "REL.L", "ULVR.L", "LSEG.L", "III.L", "EXPN.L", "DGE.L", "SMIN.L", "HSBA.L"],
  CH: ["LOGN.SW", "ROG.SW", "NESN.SW", "NOVN.SW", "SIKA.SW", "ZURN.SW", "GIVN.SW", "LONN.SW", "UHR.SW"],
  SE: ["INVE-B.ST", "ATCO-A.ST", "ERIC-B.ST", "SAAB-B.ST", "ABB.ST", "EVO.ST", "NIBE-B.ST", "ASSA-B.ST"],
  DK: ["NOVO-B.CO", "VWS.CO", "ORSTED.CO", "MAERSK-B.CO", "DSV.CO", "GMAB.CO", "PNDORA.CO"],
  NO: ["KOG.OL", "EQNR.OL", "NHY.OL", "DNB.OL", "TEL.OL", "AKRBP.OL", "MOWI.OL"],
  FI: ["NOKIA.HE", "KNEBV.HE", "SAMPO.HE", "NESTE.HE", "UPM.HE", "METSO.HE", "FORTUM.HE"],
  IT: ["LDO.MI", "ENEL.MI", "RACE.MI", "ISP.MI", "UCG.MI", "STLAM.MI", "PRY.MI", "G.MI", "MONC.MI"],
  BE: ["UCB.BR", "SOLB.BR", "ABI.BR", "KBC.BR", "GBLB.BR", "SOF.BR"],
  PT: ["EDP.LS", "GALP.LS", "JMT.LS", "EDPR.LS", "BCP.LS"],
  AT: ["EBS.VI", "ANDR.VI", "OMV.VI", "VER.VI", "VOE.VI"],
  IE: ["CRH.IR", "RYA.IR", "KRZ.IR"],
  CA: ["RY.TO", "TD.TO", "SHOP.TO", "CSU.TO", "ENB.TO", "BMO.TO", "BN.TO", "BNS.TO", "CNR.TO", "CP.TO", "CNQ.TO", "TRI.TO", "MFC.TO", "BAM.TO", "ATD.TO", "WSP.TO", "CLS.TO", "IFC.TO", "SLF.TO", "L.TO"],
  JP: ["8035.T", "6857.T", "6501.T", "7203.T", "6758.T", "6861.T", "6098.T", "9984.T", "4063.T", "7011.T", "7012.T", "7013.T"],
  HK: ["0700.HK", "0981.HK", "1810.HK", "3690.HK", "1211.HK", "1299.HK", "0388.HK", "2318.HK"],
  SG: ["D05.SI", "U11.SI", "O39.SI", "C6L.SI", "Z74.SI", "S68.SI"],
  IL: ["TEVA.TA", "NICE.TA", "ICL.TA", "ESLT.TA", "LUMI.TA", "POLI.TA", "MZTF.TA", "DSCT.TA"],
  ZA: ["NPN.JO", "PRX.JO", "CFR.JO", "AGL.JO", "BHG.JO", "SBK.JO", "FSR.JO", "MTN.JO", "ANG.JO", "GFI.JO", "SOL.JO", "SHP.JO"],
  AU: ["WTC.AX", "XRO.AX", "BHP.AX", "CSL.AX", "CBA.AX", "WES.AX", "NAB.AX", "MQG.AX", "ALL.AX", "REA.AX"],
  US: ["NVDA", "MSFT", "AAPL", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "BRK-B", "LLY", "JPM", "V", "MA", "NFLX", "COST", "WMT", "ORCL", "XOM", "HD", "PG", "JNJ", "ABBV", "BAC", "KO", "PLTR", "AMD", "CRM", "CSCO", "CVX", "WFC", "IBM", "MRK", "PM", "GE", "UNH", "ABT", "MCD", "LIN", "AXP", "MS", "DIS", "NOW", "TMO", "ISRG", "GS", "PEP", "INTU", "QCOM", "BKNG", "TXN", "CAT", "UBER", "RTX", "VZ", "T", "AMGN", "SPGI", "PGR", "DHR", "BLK", "NEE", "LOW", "HON", "SYK", "SCHW", "TJX", "ADBE", "BSX", "ETN", "PFE", "UNP", "PANW", "ANET", "BA", "COF", "GILD", "DE", "MU", "AMAT", "LRCX", "KLAC", "ADI", "MRVL", "MCHP", "MPWR", "ON", "INTC", "CRWD", "FTNT", "SNOW", "DDOG", "NET", "TEAM", "MDB", "APP", "SMCI", "DELL", "COIN", "MSTR", "HOOD", "ABNB", "DASH", "RBLX", "PINS", "CMG", "NKE", "SBUX", "TGT", "MAR", "RCL", "NCLH", "LMT", "NOC", "GD", "PH", "MMM", "UPS", "CSX", "NSC", "COP", "EOG", "SLB", "OXY", "LNG", "WMB", "KMI", "MPC", "VLO", "FCX", "NEM", "SCCO", "APD", "SHW", "ECL", "CMCSA", "TMUS", "CHTR", "MDLZ", "CL", "KMB", "GIS", "KHC", "EL", "DUK", "SO", "AEP", "CEG", "EXC", "SRE", "PLD", "AMT", "EQIX", "WELL", "O", "SPG"],
};

export const EXTRA_UNIVERSES = {
  ES: ["ANA.MC", "ACX.MC", "ACS.MC", "ANE.MC", "BKT.MC", "COL.MC", "ENG.MC", "FDR.MC", "IAG.MC", "IDR.MC", "MAP.MC", "MEL.MC", "RED.MC", "SCYR.MC", "SLR.MC", "UNI.MC"],
  DE: ["BAS.DE", "BAYN.DE", "CON.DE", "DB1.DE", "DBK.DE", "DPW.DE", "EOAN.DE", "FRE.DE", "HEN3.DE", "MRK.DE", "MTX.DE", "MUV2.DE", "PAH3.DE", "PUM.DE", "QIA.DE", "VOW3.DE", "ZAL.DE"],
  FR: ["ACA.PA", "BN.PA", "BNP.PA", "CA.PA", "DG.PA", "EL.PA", "EN.PA", "ENGI.PA", "ERF.PA", "GLE.PA", "KER.PA", "LR.PA", "ML.PA", "ORA.PA", "PUB.PA", "SAN.PA", "SGO.PA", "STM.PA", "VIV.PA"],
  NL: ["ABN.AS", "AGN.AS", "AKZA.AS", "ARCAD.AS", "ASRNL.AS", "IMCD.AS", "JDEP.AS", "KPN.AS", "NN.AS", "OCI.AS", "RAND.AS", "TKWY.AS"],
  GB: ["AAL.L", "ABF.L", "ADM.L", "ANTO.L", "AUTO.L", "AV.L", "BARC.L", "BATS.L", "BP.L", "BT-A.L", "CNA.L", "CPG.L", "CRDA.L", "CRH.L", "EZJ.L", "GSK.L", "HLMA.L", "IMB.L", "INF.L", "KGF.L", "LAND.L", "LLOY.L", "MNG.L", "NG.L", "PSN.L", "RIO.L", "SGE.L", "SSE.L", "STAN.L", "TSCO.L", "VOD.L", "WTB.L"],
  CH: ["ABBN.SW", "ADEN.SW", "CFR.SW", "CLN.SW", "HOLN.SW", "KNIN.SW", "PGHN.SW", "SGSN.SW", "SLHN.SW", "SREN.SW", "STMN.SW", "UBSG.SW"],
  SE: ["ALFA.ST", "AZN.ST", "BOL.ST", "EQT.ST", "ESSITY-B.ST", "HEXA-B.ST", "HM-B.ST", "SAND.ST", "SEB-A.ST", "SHB-A.ST", "SKF-B.ST", "SWED-A.ST", "TELIA.ST", "VOLV-B.ST", "ASSA-B.ST", "EPI-A.ST", "EPI-B.ST", "GETI-B.ST", "INDU-C.ST", "LATO-B.ST", "LIFCO-B.ST", "SCA-B.ST", "SKA-B.ST", "TEL2-B.ST", "TREL-B.ST", "THULE.ST", "ELUX-B.ST", "HUSQ-B.ST", "SOBI.ST", "VITR.ST", "CAMX.ST", "HMS.ST", "CAST.ST", "BALD-B.ST"],
  DK: ["CARL-B.CO", "COLO-B.CO", "DANSKE.CO", "FLS.CO", "ISS.CO", "JYSK.CO", "ROCK-B.CO", "TRYG.CO", "AMBU-B.CO", "ALK-B.CO", "BAVA.CO", "DEMANT.CO", "DFDS.CO", "GN.CO", "NETC.CO", "NKT.CO", "RBREW.CO", "SIM.CO", "SYDB.CO", "ZEAL.CO"],
  NO: ["AKER.OL", "GJF.OL", "ORK.OL", "SALM.OL", "SUBC.OL", "TGS.OL", "YAR.OL", "AKSO.OL", "ATEA.OL", "BAKKA.OL", "BWO.OL", "ELK.OL", "GOGL.OL", "HAUTO.OL", "LSG.OL", "MPCC.OL", "NAS.OL", "NEL.OL", "NOD.OL", "PGS.OL", "SCHA.OL", "STB.OL", "VAR.OL", "WAWI.OL"],
  FI: ["ELISA.HE", "KESKOB.HE", "ORNBV.HE", "OUT1V.HE", "VALMT.HE", "WRT1V.HE"],
  IT: ["AMP.MI", "BAMI.MI", "BMED.MI", "BPE.MI", "CPR.MI", "DIA.MI", "FBK.MI", "HER.MI", "IG.MI", "INW.MI", "NEXI.MI", "PIRC.MI", "REC.MI", "SRG.MI", "TEN.MI", "TRN.MI"],
  CA: ["CM.TO", "NA.TO", "GWO.TO", "FFH.TO", "WCN.TO", "GIB-A.TO", "DOL.TO", "MRU.TO", "QSR.TO", "CTC-A.TO", "TFII.TO", "MG.TO", "TIH.TO", "CAE.TO", "CCL-B.TO", "RBA.TO", "NTR.TO", "AEM.TO", "ABX.TO", "FNV.TO", "WPM.TO", "K.TO", "AGI.TO", "PAAS.TO", "TECK-B.TO", "LUN.TO", "FM.TO", "IVN.TO", "CCO.TO", "DML.TO", "SU.TO", "IMO.TO", "CVE.TO", "TOU.TO", "ARX.TO", "MEG.TO", "WCP.TO", "FTS.TO", "EMA.TO", "BCE.TO", "T.TO", "RCI-B.TO", "QBR-B.TO", "DSG.TO", "DOO.TO", "GFL.TO", "CIX.TO", "KXS.TO", "OTEX.TO", "BB.TO", "POW.TO", "WN.TO", "EMP-A.TO", "PBH.TO", "GIL.TO", "WFG.TO", "SJ.TO", "IFP.TO", "STN.TO", "CIGI.TO", "FSV.TO", "X.TO", "IAG.TO", "EQB.TO", "GSY.TO", "ONEX.TO", "ATS.TO", "MDA.TO", "BYD.TO", "SAP.TO", "JWEL.TO", "PET.TO", "TOY.TO", "LNF.TO", "GOOS.TO", "PPL.TO", "KEY.TO", "ALA.TO", "CPX.TO", "H.TO", "CU.TO", "GEI.TO", "BTE.TO", "NXE.TO", "BTO.TO", "EDV.TO", "EQX.TO", "IMG.TO", "SSL.TO", "TXG.TO", "OR.TO", "NGD.TO", "LSPD.TO", "DCBO.TO", "DND.TO", "WELL.TO", "TIXT.TO", "CTS.TO", "RUS.TO", "MAL.TO", "GRT-UN.TO", "CAR-UN.TO", "REI-UN.TO", "DIR-UN.TO", "SRU-UN.TO", "HR-UN.TO", "CRT-UN.TO", "AP-UN.TO", "BEI-UN.TO", "NWH-UN.TO"],
  JP: ["9983.T", "7974.T", "4502.T", "4519.T", "4568.T", "4543.T", "6367.T", "6594.T", "6981.T", "6762.T", "6954.T", "7741.T", "7735.T", "6146.T", "6920.T", "6723.T", "9432.T", "9433.T", "9434.T", "8306.T", "8316.T", "8411.T", "8766.T", "8591.T", "8001.T", "8031.T", "8058.T", "8002.T", "8053.T", "4661.T", "2914.T", "4452.T", "4911.T", "5108.T", "7267.T", "7269.T", "7270.T", "6902.T", "6503.T", "6702.T", "6701.T", "6645.T", "6971.T", "6963.T", "7751.T", "4901.T", "3382.T", "9020.T", "9022.T", "9201.T", "9202.T", "5401.T", "5713.T", "5803.T", "5802.T", "3436.T", "6273.T", "6326.T", "6506.T", "9962.T", "9843.T"],
  HK: ["0001.HK", "0002.HK", "0003.HK", "0005.HK", "0006.HK", "0011.HK", "0012.HK", "0016.HK", "0017.HK", "0027.HK", "0066.HK", "0101.HK", "0175.HK", "0241.HK", "0267.HK", "0285.HK", "0288.HK", "0291.HK", "0316.HK", "0386.HK", "0669.HK", "0688.HK", "0762.HK", "0823.HK", "0836.HK", "0857.HK", "0883.HK", "0939.HK", "0960.HK", "0968.HK", "0992.HK", "0998.HK", "1024.HK", "1038.HK", "1093.HK", "1109.HK", "1113.HK", "1177.HK", "1209.HK", "1378.HK", "1876.HK", "1928.HK", "1997.HK", "2015.HK", "2020.HK", "2269.HK", "2313.HK", "2319.HK", "2331.HK", "2382.HK", "2388.HK", "2601.HK", "2628.HK", "2688.HK", "2899.HK", "3888.HK", "3968.HK", "3988.HK", "6098.HK", "6618.HK", "6690.HK", "6809.HK", "6862.HK", "9618.HK", "9633.HK", "9888.HK", "9988.HK", "9999.HK"],
  SG: ["BN4.SI", "F34.SI", "U96.SI", "G13.SI", "C09.SI", "C38U.SI", "A17U.SI", "M44U.SI", "N2IU.SI", "ME8U.SI", "T82U.SI", "AJBU.SI", "BUOU.SI", "CJLU.SI", "D01.SI", "H78.SI", "J36.SI", "BS6.SI", "S58.SI", "9CI.SI", "V03.SI", "AWX.SI", "BSL.SI", "U14.SI", "S63.SI", "H02.SI", "C52.SI", "F03.SI", "AIY.SI", "E5H.SI", "C2PU.SI", "K71U.SI", "M01.SI", "O5RU.SI", "SK6U.SI", "Y92.SI", "Q5T.SI", "B61.SI", "558.SI"],
  TW: ["2330.TW", "2317.TW", "2454.TW", "2308.TW", "2382.TW", "2412.TW", "2881.TW", "2882.TW", "2891.TW", "3711.TW", "2303.TW", "2357.TW"],
  KR: ["005930.KS", "000660.KS", "005380.KS", "000270.KS", "035420.KS", "035720.KS", "051910.KS", "006400.KS", "068270.KS", "207940.KS"],
  IN: ["KOTAKBANK.NS", "AXISBANK.NS", "HCLTECH.NS", "WIPRO.NS", "TECHM.NS", "SUNPHARMA.NS", "CIPLA.NS", "DRREDDY.NS", "DIVISLAB.NS", "TATAMOTORS.NS", "LTIM.NS", "EICHERMOT.NS", "BAJAJ-AUTO.NS", "HEROMOTOCO.NS", "TITAN.NS", "ASIANPAINT.NS", "ULTRACEMCO.NS", "GRASIM.NS", "JSWSTEEL.NS", "TATASTEEL.NS", "HINDALCO.NS", "COALINDIA.NS", "NTPC.NS", "POWERGRID.NS", "ONGC.NS", "ADANIENT.NS", "ADANIPORTS.NS", "ADANIGREEN.NS", "ADANIPOWER.NS", "TRENT.NS", "DMART.NS", "PIDILITIND.NS", "NESTLEIND.NS", "BRITANNIA.NS", "TATACONSUM.NS", "HAVELLS.NS", "DIXON.NS", "POLYCAB.NS", "ABB.NS", "SIEMENS.NS", "HAL.NS", "BEL.NS", "BDL.NS", "MAZDOCK.NS", "COCHINSHIP.NS", "IRCTC.NS", "INDIGO.NS", "JIOFIN.NS", "IRFC.NS", "PFC.NS", "RECLTD.NS", "BAJAJFINSV.NS", "HDFCLIFE.NS", "SBILIFE.NS", "ICICIPRULI.NS", "SHREECEM.NS", "APOLLOHOSP.NS", "MAXHEALTH.NS", "GODREJCP.NS", "DABUR.NS", "MARICO.NS", "COLPAL.NS", "MOTHERSON.NS", "BOSCHLTD.NS", "TVSMOTOR.NS", "BAJAJHLDNG.NS", "VEDL.NS", "BPCL.NS", "IOC.NS", "GAIL.NS", "ASHOKLEY.NS", "CUMMINSIND.NS", "PERSISTENT.NS", "TATAELXSI.NS", "MPHASIS.NS"],
  IL: ["FIBI.TA", "BEZQ.TA", "ORA.TA", "ENLT.TA", "AZRG.TA", "BIG.TA", "AMOT.TA", "DLEKG.TA", "NWMD.TA", "OPCE.TA", "ELTR.TA", "FTAL.TA", "FOX.TA", "MTRX.TA", "NVMI.TA", "CAMT.TA", "TSEM.TA", "ISCD.TA", "PHOE.TA", "CLIS.TA", "HLAN.TA", "MGDL.TA", "ILCO.TA", "AFHL.TA", "ONE.TA"],
  ZA: ["ABG.JO", "NED.JO", "CPI.JO", "INL.JO", "INP.JO", "REM.JO", "BID.JO", "BVT.JO", "DSY.JO", "SLM.JO", "OMU.JO", "OUT.JO", "VOD.JO", "BTI.JO", "ANH.JO", "S32.JO", "CLS.JO", "APN.JO", "NTC.JO", "LHC.JO", "WHL.JO", "TFG.JO", "MRP.JO", "TRU.JO", "PIK.JO", "SPP.JO", "TBS.JO", "AVI.JO", "EXX.JO", "KIO.JO", "IMP.JO", "AMS.JO", "SSW.JO", "NPH.JO", "HAR.JO", "MNP.JO", "GLN.JO", "RNI.JO", "MCG.JO", "KAP.JO", "TCP.JO", "DCP.JO", "PPH.JO"],
  CN: ["600519.SS", "601398.SS", "601857.SS", "601318.SS", "600036.SS", "600276.SS", "600030.SS", "600309.SS", "000333.SZ", "000651.SZ", "000858.SZ", "002475.SZ", "300750.SZ", "300760.SZ"],
  BR: ["PETR4.SA", "VALE3.SA", "ITUB4.SA", "BBDC4.SA", "ABEV3.SA", "WEGE3.SA", "BBAS3.SA", "B3SA3.SA", "RENT3.SA", "SUZB3.SA"],
  MX: ["AMXB.MX", "WALMEX.MX", "GMEXICOB.MX", "FEMSAUBD.MX", "CEMEXCPO.MX", "GFNORTEO.MX", "BIMBOA.MX", "TLEVISACPO.MX"],
};

const CANADA_EXPANDED_CORE = [
  "TRP.TO", "AQN.TO", "NPI.TO", "BLX.TO", "BEP-UN.TO", "BIP-UN.TO", "BIPC.TO", "BEPC.TO",
  "CCA.TO", "LB.TO", "DFY.TO", "IGM.TO", "SII.TO", "TSU.TO", "NFI.TO",
  "BDGI.TO", "WJX.TO", "BDT.TO", "KBL.TO", "MX.TO", "CFP.TO", "AIF.TO", "CS.TO", "HBM.TO", "ERO.TO",
  "DPM.TO", "KNT.TO", "LUG.TO", "SEA.TO", "NG.TO", "OGC.TO", "WDO.TO", "ARIS.TO", "GMIN.TO",
  "CXB.TO", "VET.TO", "PEY.TO", "BIR.TO", "TVE.TO", "FRU.TO", "NVA.TO", "ATH.TO", "KEL.TO", "AAV.TO",
  "PXT.TO", "TPZ.TO", "IPCO.TO", "MTY.TO", "LAS-A.TO", "SIS.TO", "CSH-UN.TO", "SIA.TO", "MRE.TO",
  "LNR.TO", "HPS-A.TO", "MATR.TO", "IIP-UN.TO", "KMP-UN.TO", "PMZ-UN.TO", "MI-UN.TO",
  "CHP-UN.TO", "DRM.TO", "TCL-A.TO", "CJT.TO", "RCH.TO", "ADEN.TO", "EIF.TO", "FTT.TO", "ARE.TO", "MFI.TO", "NWC.TO", "PSK.TO",
  "WTE.TO", "GUD.TO", "FSZ.TO",
];

const SWITZERLAND_EXPANDED_CORE = [
  "GEBN.SW", "SOON.SW", "SCMN.SW", "SCHP.SW", "TEMN.SW", "TECN.SW",
  "BARN.SW", "BEAN.SW", "BKW.SW", "BALN.SW", "BANB.SW", "BCVN.SW",
  "BION.SW", "BCHN.SW", "BUCN.SW", "CMBN.SW", "COTN.SW", "DOCM.SW",
  "EFGN.SW", "EMSN.SW", "FHZN.SW", "GALD.SW", "HELN.SW", "HIAG.SW",
  "HUBN.SW", "IMPN.SW", "INRN.SW", "KARN.SW", "LAND.SW", "LISN.SW",
  "LISP.SW", "MEDX.SW", "METN.SW", "MOZN.SW", "PSPN.SW", "RIEN.SW",
  "SFSN.SW", "SIGN.SW", "SKAN.SW", "SOFN.SW", "STGN.SW", "VACN.SW",
  "VATN.SW", "VZN.SW", "VZUG.SW", "WIHN.SW", "YPSN.SW", "ZEHN.SW",
];

const EXPANDED_CORE_UNIVERSES = {
  CA: CANADA_EXPANDED_CORE,
  CH: SWITZERLAND_EXPANDED_CORE,
};

export function marketSymbols(code) {
  return Array.from(new Set([...(CURATED[code] || []), ...(EXTRA_UNIVERSES[code] || []), ...(EXPANDED_CORE_UNIVERSES[code] || [])]));
}

function isInvestableAsicProduct(row = {}) {
  const code = String(row.productCode || "").trim();
  const name = String(row.productName || "").toUpperCase();
  if (!/^[A-Z0-9]{2,6}$/.test(code)) return false;
  if (/\b(ETF|ETFS|TREASURY|BOND|BONDS|LOAN|NOTES?|WARRANT|OPTION|FUND)\b/.test(name)) return false;
  return /\b(ORDINARY|STAPLED|CDI|FOREXEMPT|FOR\. EXEMPT|UNITS)\b/.test(name);
}

async function fetchAsicShortUniverse() {
  const report = await fetchLatestAsicShortReport().catch((error) => {
    recordProviderFailure("AU", error, { status: "degraded" });
    throw error;
  });
  if (report.providerStatus?.cacheMode !== "stale") recordProviderSuccess("AU", { count: report.rows?.length || 0 });
  return report.rows
    .filter(isInvestableAsicProduct)
    .map((row) => ({
      symbol: row.symbol,
      name: row.productName || row.symbol,
      country: "AU",
      source: "ASIC short position reports",
    }));
}

async function fetchOfficialMarketUniverse(code) {
  const policy = universeProviderForMarket(code);
  if (policy && !policy.configured) return [];
  if (policy && shouldSkipProviderFetch(code)) return [];
  let rows = [];
  try {
    if (code === "HK") rows = await fetchHkexUniverse();
    else if (code === "JP") rows = await fetchJquantsUniverse();
    else if (code === "TW") rows = await fetchTwseUniverse();
    else if (code === "GB") rows = await fetchFcaFirdsUniverse(code);
    else if (FIRDS_MARKETS.has(code)) rows = await fetchFirdsUniverse(code);
    else rows = [];
    if (policy) recordProviderSuccess(code, { count: rows.length });
    return rows;
  } catch (error) {
    if (policy) recordProviderFailure(code, error);
    throw error;
  }
  return [];
}

function universeEntries() {
  const codes = Array.from(new Set([...Object.keys(CURATED), ...Object.keys(EXTRA_UNIVERSES), ...Object.keys(EXPANDED_CORE_UNIVERSES)]));
  return codes.map((code) => [code, marketSymbols(code)]);
}

export const CURATED_NAMES = {
  "IBE.MC": "Iberdrola", "ITX.MC": "Inditex Industria de Diseno Textil", "AMS.MC": "Amadeus IT Group", "SAN.MC": "Banco Santander", "BBVA.MC": "BBVA Banco Bilbao Vizcaya Argentaria", "AENA.MC": "Aena", "GRF.MC": "Grifols", "FER.MC": "Ferrovial", "CABK.MC": "CaixaBank", "CLNX.MC": "Cellnex", "ELE.MC": "Endesa", "NTGY.MC": "Naturgy", "REP.MC": "Repsol", "TEF.MC": "Telefonica", "MRL.MC": "Merlin Properties", "ROVI.MC": "Laboratorios Rovi", "LOG.MC": "Logista",
  "SAP.DE": "SAP", "SIE.DE": "Siemens", "RHM.DE": "Rheinmetall", "ALV.DE": "Allianz", "DTE.DE": "Deutsche Telekom", "MBG.DE": "Mercedes Benz Group", "BMW.DE": "BMW Bayerische Motoren Werke", "ADS.DE": "Adidas", "IFX.DE": "Infineon", "DHER.DE": "Delivery Hero", "HNR1.DE": "Hannover Rueck", "ENR.DE": "Siemens Energy", "SHL.DE": "Siemens Healthineers", "BEI.DE": "Beiersdorf", "AFX.DE": "Carl Zeiss Meditec", "MUV2.DE": "Munich Re",
  "HO.PA": "Thales", "SAF.PA": "Safran", "SU.PA": "Schneider Electric", "AI.PA": "Air Liquide", "OR.PA": "L'Oreal", "MC.PA": "LVMH", "TTE.PA": "TotalEnergies", "CAP.PA": "Capgemini", "DSY.PA": "Dassault Systemes", "RMS.PA": "Hermes", "AIR.PA": "Airbus", "STMPA.PA": "STMicroelectronics", "VIE.PA": "Veolia", "RI.PA": "Pernod Ricard",
  "ASML.AS": "ASML", "ASM.AS": "ASM International", "BESI.AS": "BE Semiconductor Industries BESI", "ADYEN.AS": "Adyen", "PRX.AS": "Prosus", "INGA.AS": "ING Group", "WKL.AS": "Wolters Kluwer", "PHIA.AS": "Philips", "HEIA.AS": "Heineken", "UMG.AS": "Universal Music Group",
  "RR.L": "Rolls Royce", "BA.L": "BAE Systems", "SHEL.L": "Shell", "AZN.L": "AstraZeneca", "REL.L": "RELX", "ULVR.L": "Unilever", "LSEG.L": "London Stock Exchange Group", "III.L": "3i Group", "EXPN.L": "Experian", "DGE.L": "Diageo", "SMIN.L": "Smiths Group", "HSBA.L": "HSBC",
  "LOGN.SW": "Logitech", "ROG.SW": "Roche", "NESN.SW": "Nestle", "NOVN.SW": "Novartis", "SIKA.SW": "Sika", "ZURN.SW": "Zurich Insurance", "GIVN.SW": "Givaudan", "LONN.SW": "Lonza", "UHR.SW": "Swatch",
  "INVE-B.ST": "Investor", "ATCO-A.ST": "Atlas Copco", "ERIC-B.ST": "Ericsson", "SAAB-B.ST": "Saab", "ABB.ST": "ABB", "EVO.ST": "Evolution", "NIBE-B.ST": "Nibe", "ASSA-B.ST": "Assa Abloy",
  "NOVO-B.CO": "Novo Nordisk", "VWS.CO": "Vestas Wind Systems", "ORSTED.CO": "Orsted", "MAERSK-B.CO": "Maersk", "DSV.CO": "DSV", "GMAB.CO": "Genmab", "PNDORA.CO": "Pandora",
  "KOG.OL": "Kongsberg Gruppen", "EQNR.OL": "Equinor", "NHY.OL": "Norsk Hydro", "DNB.OL": "DNB Bank", "TEL.OL": "Telenor", "AKRBP.OL": "Aker BP", "MOWI.OL": "Mowi",
  "NOKIA.HE": "Nokia", "KNEBV.HE": "Kone", "SAMPO.HE": "Sampo", "NESTE.HE": "Neste", "UPM.HE": "UPM Kymmene", "METSO.HE": "Metso", "FORTUM.HE": "Fortum",
  "LDO.MI": "Leonardo", "ENEL.MI": "Enel", "RACE.MI": "Ferrari", "ISP.MI": "Intesa Sanpaolo", "UCG.MI": "UniCredit", "STLAM.MI": "Stellantis", "PRY.MI": "Prysmian", "G.MI": "Assicurazioni Generali", "MONC.MI": "Moncler",
  "UCB.BR": "UCB", "SOLB.BR": "Solvay", "ABI.BR": "Anheuser Busch InBev AB InBev", "KBC.BR": "KBC Group", "GBLB.BR": "Groupe Bruxelles Lambert", "SOF.BR": "Sofina",
  "EDP.LS": "EDP Energias de Portugal", "GALP.LS": "Galp Energia", "JMT.LS": "Jeronimo Martins", "EDPR.LS": "EDP Renovaveis", "BCP.LS": "Banco Comercial Portugues Millennium BCP",
  "EBS.VI": "Erste Group Bank", "ANDR.VI": "Andritz", "OMV.VI": "OMV", "VER.VI": "Verbund", "VOE.VI": "Voestalpine",
  "CRH.IR": "CRH", "RYA.IR": "Ryanair", "KRZ.IR": "Kerry Group",
  "SHOP.TO": "Shopify", "CLS.TO": "Celestica", "CSU.TO": "Constellation Software", "WSP.TO": "WSP Global", "ATD.TO": "Alimentation Couche Tard", "BAM.TO": "Brookfield Asset Management", "CNQ.TO": "Canadian Natural Resources", "TRI.TO": "Thomson Reuters", "L.TO": "Loblaw",
  "8035.T": "Tokyo Electron", "6857.T": "Advantest", "6501.T": "Hitachi", "7203.T": "Toyota", "6758.T": "Sony", "6861.T": "Keyence", "6098.T": "Recruit Holdings", "9984.T": "SoftBank Group", "4063.T": "Shin Etsu Chemical", "7011.T": "Mitsubishi Heavy Industries", "7012.T": "Kawasaki Heavy Industries", "7013.T": "IHI",
  "9983.T": "Fast Retailing", "7974.T": "Nintendo", "4502.T": "Takeda Pharmaceutical", "4519.T": "Chugai Pharmaceutical", "4568.T": "Daiichi Sankyo", "4543.T": "Terumo", "6367.T": "Daikin Industries", "6594.T": "Nidec", "6981.T": "Murata Manufacturing", "6762.T": "TDK", "6954.T": "Fanuc", "7741.T": "Hoya", "7735.T": "Screen Holdings", "6146.T": "Disco", "6920.T": "Lasertec", "6723.T": "Renesas Electronics", "9432.T": "Nippon Telegraph and Telephone", "9433.T": "KDDI", "9434.T": "SoftBank Corp", "8306.T": "Mitsubishi UFJ Financial Group", "8316.T": "Sumitomo Mitsui Financial Group", "8411.T": "Mizuho Financial Group", "8766.T": "Tokio Marine", "8591.T": "Orix", "8001.T": "Itochu", "8031.T": "Mitsui", "8058.T": "Mitsubishi Corporation", "8002.T": "Marubeni", "8053.T": "Sumitomo Corporation", "4661.T": "Oriental Land", "2914.T": "Japan Tobacco", "4452.T": "Kao", "4911.T": "Shiseido", "5108.T": "Bridgestone", "7267.T": "Honda", "7269.T": "Suzuki Motor", "7270.T": "Subaru", "6902.T": "Denso", "6503.T": "Mitsubishi Electric", "6702.T": "Fujitsu", "6701.T": "NEC", "6645.T": "Omron", "6971.T": "Kyocera", "6963.T": "Rohm", "7751.T": "Canon", "4901.T": "Fujifilm", "3382.T": "Seven & i Holdings", "9020.T": "JR East", "9022.T": "JR Central", "9201.T": "Japan Airlines", "9202.T": "ANA Holdings", "5401.T": "Nippon Steel", "5713.T": "Sumitomo Metal Mining", "5803.T": "Fujikura", "5802.T": "Sumitomo Electric Industries", "3436.T": "Sumco", "6273.T": "SMC", "6326.T": "Kubota", "6506.T": "Yaskawa Electric", "9962.T": "Misumi Group", "9843.T": "Nitori Holdings",
  "0700.HK": "Tencent", "0981.HK": "SMIC Semiconductor Manufacturing International", "1810.HK": "Xiaomi", "3690.HK": "Meituan", "1211.HK": "BYD", "1299.HK": "AIA Group", "0388.HK": "Hong Kong Exchanges HKEX", "2318.HK": "Ping An Insurance", "0001.HK": "CK Hutchison", "0002.HK": "CLP Holdings", "0003.HK": "Hong Kong and China Gas", "0005.HK": "HSBC Holdings", "0006.HK": "Power Assets", "0011.HK": "Hang Seng Bank", "0012.HK": "Henderson Land", "0016.HK": "Sun Hung Kai Properties", "0017.HK": "New World Development", "0027.HK": "Galaxy Entertainment", "0066.HK": "MTR", "0101.HK": "Hang Lung Properties", "0175.HK": "Geely Automobile", "0241.HK": "Alibaba Health", "0267.HK": "CITIC", "0285.HK": "BYD Electronic", "0288.HK": "WH Group", "0291.HK": "China Resources Beer", "0316.HK": "Orient Overseas International", "0386.HK": "Sinopec", "0669.HK": "Techtronic Industries", "0688.HK": "China Overseas Land", "0762.HK": "China Unicom", "0823.HK": "Link REIT", "0836.HK": "China Resources Power", "0857.HK": "PetroChina", "0883.HK": "CNOOC", "0939.HK": "China Construction Bank", "0960.HK": "Longfor Group", "0968.HK": "Xinyi Solar", "0992.HK": "Lenovo", "0998.HK": "China CITIC Bank", "1024.HK": "Kuaishou", "1038.HK": "CK Infrastructure", "1093.HK": "CSPC Pharmaceutical", "1109.HK": "China Resources Land", "1113.HK": "CK Asset", "1177.HK": "Sino Biopharmaceutical", "1209.HK": "China Resources Mixc", "1378.HK": "China Hongqiao", "1876.HK": "Budweiser APAC", "1928.HK": "Sands China", "1997.HK": "Wharf REIC", "2015.HK": "Li Auto", "2020.HK": "Anta Sports", "2269.HK": "WuXi Biologics", "2313.HK": "Shenzhou International", "2319.HK": "Mengniu Dairy", "2331.HK": "Li Ning", "2382.HK": "Sunny Optical", "2388.HK": "BOC Hong Kong", "2601.HK": "China Pacific Insurance", "2628.HK": "China Life", "2688.HK": "ENN Energy", "2899.HK": "Zijin Mining", "3888.HK": "Kingsoft", "3968.HK": "China Merchants Bank", "3988.HK": "Bank of China", "6098.HK": "Country Garden Services", "6618.HK": "JD Health", "6690.HK": "Haier Smart Home", "6809.HK": "Hong Kong Technology Venture", "6862.HK": "Haidilao", "9618.HK": "JD.com", "9633.HK": "Nongfu Spring", "9888.HK": "Baidu", "9988.HK": "Alibaba", "9999.HK": "NetEase",
  "D05.SI": "DBS Group", "U11.SI": "United Overseas Bank UOB", "O39.SI": "OCBC Oversea Chinese Banking", "C6L.SI": "Singapore Airlines", "Z74.SI": "Singtel", "S68.SI": "Singapore Exchange SGX",
  "NPN.JO": "Naspers", "PRX.JO": "Prosus", "CFR.JO": "Richemont", "AGL.JO": "Anglo American", "BHG.JO": "BHP Group", "SBK.JO": "Standard Bank", "FSR.JO": "FirstRand", "MTN.JO": "MTN Group", "ANG.JO": "AngloGold Ashanti", "GFI.JO": "Gold Fields", "SOL.JO": "Sasol", "SHP.JO": "Shoprite",
  "WTC.AX": "WiseTech Global", "XRO.AX": "Xero", "BHP.AX": "BHP", "CSL.AX": "CSL", "CBA.AX": "Commonwealth Bank", "WES.AX": "Wesfarmers", "NAB.AX": "National Australia Bank", "MQG.AX": "Macquarie Group", "ALL.AX": "Aristocrat Leisure", "REA.AX": "REA Group",
};

const CORE_CURATED_NAMES = {
  "RY.TO": "Royal Bank of Canada", "TD.TO": "Toronto-Dominion Bank", "ENB.TO": "Enbridge", "BMO.TO": "Bank of Montreal", "BN.TO": "Brookfield", "BNS.TO": "Bank of Nova Scotia", "CNR.TO": "Canadian National Railway", "CP.TO": "Canadian Pacific Kansas City", "MFC.TO": "Manulife Financial", "IFC.TO": "Intact Financial", "SLF.TO": "Sun Life Financial", "CM.TO": "Canadian Imperial Bank of Commerce", "NA.TO": "National Bank of Canada", "WCN.TO": "Waste Connections", "DOL.TO": "Dollarama", "MRU.TO": "Metro", "QSR.TO": "Restaurant Brands International", "TFII.TO": "TFI International", "AEM.TO": "Agnico Eagle Mines", "SU.TO": "Suncor Energy", "CVE.TO": "Cenovus Energy", "FTS.TO": "Fortis", "BCE.TO": "BCE", "T.TO": "Telus",
  "KOTAKBANK.NS": "Kotak Mahindra Bank", "AXISBANK.NS": "Axis Bank", "HCLTECH.NS": "HCL Technologies", "WIPRO.NS": "Wipro", "TECHM.NS": "Tech Mahindra", "SUNPHARMA.NS": "Sun Pharmaceutical", "CIPLA.NS": "Cipla", "DRREDDY.NS": "Dr Reddy's Laboratories", "TATAMOTORS.NS": "Tata Motors", "LTIM.NS": "LTIMindtree", "TITAN.NS": "Titan", "ASIANPAINT.NS": "Asian Paints", "ULTRACEMCO.NS": "UltraTech Cement", "JSWSTEEL.NS": "JSW Steel", "TATASTEEL.NS": "Tata Steel", "HAL.NS": "Hindustan Aeronautics", "BEL.NS": "Bharat Electronics", "SIEMENS.NS": "Siemens India", "ABB.NS": "ABB India", "INDIGO.NS": "InterGlobe Aviation", "PERSISTENT.NS": "Persistent Systems", "MPHASIS.NS": "Mphasis",
  "STN.TO": "Stantec", "CIGI.TO": "Colliers International", "FSV.TO": "FirstService", "X.TO": "TMX Group", "IAG.TO": "iA Financial", "EQB.TO": "EQB", "GSY.TO": "goeasy", "PPL.TO": "Pembina Pipeline", "KEY.TO": "Keyera", "ALA.TO": "AltaGas", "CPX.TO": "Capital Power", "H.TO": "Hydro One", "NXE.TO": "NexGen Energy", "LSPD.TO": "Lightspeed Commerce", "DCBO.TO": "Docebo", "WELL.TO": "WELL Health",
  "BN4.SI": "Keppel", "F34.SI": "Wilmar International", "U96.SI": "Sembcorp Industries", "G13.SI": "Genting Singapore", "C09.SI": "City Developments", "C38U.SI": "CapitaLand Integrated Commercial Trust", "A17U.SI": "CapitaLand Ascendas REIT", "M44U.SI": "Mapletree Logistics Trust", "S63.SI": "Singapore Technologies Engineering", "9CI.SI": "CapitaLand Investment", "V03.SI": "Venture", "AWX.SI": "AEM Holdings",
  "TEVA.TA": "Teva Pharmaceutical", "NICE.TA": "Nice", "ICL.TA": "ICL Group", "ESLT.TA": "Elbit Systems", "LUMI.TA": "Bank Leumi", "POLI.TA": "Bank Hapoalim", "MZTF.TA": "Mizrahi Tefahot Bank", "DSCT.TA": "Israel Discount Bank", "BEZQ.TA": "Bezeq", "ENLT.TA": "Enlight Renewable Energy", "AZRG.TA": "Azrieli Group", "NVMI.TA": "Nova", "CAMT.TA": "Camtek", "TSEM.TA": "Tower Semiconductor", "MTRX.TA": "Matrix IT",
  "ABG.JO": "Absa Group", "NED.JO": "Nedbank Group", "CPI.JO": "Capitec Bank", "INL.JO": "Investec", "INP.JO": "Investec plc", "REM.JO": "Remgro", "BID.JO": "Bid Corporation", "BVT.JO": "Bidvest", "DSY.JO": "Discovery", "SLM.JO": "Sanlam", "OMU.JO": "Old Mutual", "OUT.JO": "OUTsurance", "VOD.JO": "Vodacom", "BTI.JO": "British American Tobacco", "ANH.JO": "AB InBev", "S32.JO": "South32", "CLS.JO": "Clicks Group", "APN.JO": "Aspen Pharmacare", "NTC.JO": "Netcare", "LHC.JO": "Life Healthcare", "WHL.JO": "Woolworths Holdings", "TFG.JO": "The Foschini Group", "MRP.JO": "Mr Price", "TRU.JO": "Truworths International", "PIK.JO": "Pick n Pay", "SPP.JO": "Spar Group", "TBS.JO": "Tiger Brands", "AVI.JO": "AVI", "EXX.JO": "Exxaro Resources", "KIO.JO": "Kumba Iron Ore", "IMP.JO": "Impala Platinum", "AMS.JO": "Anglo American Platinum", "SSW.JO": "Sibanye Stillwater", "NPH.JO": "Northam Platinum", "HAR.JO": "Harmony Gold", "MNP.JO": "Mondi", "GLN.JO": "Glencore", "RNI.JO": "Reinet Investments", "MCG.JO": "MultiChoice Group", "KAP.JO": "KAP", "DCP.JO": "Dis-Chem Pharmacies", "PPH.JO": "Pepkor",
};

function curatedName(symbol) {
  return CURATED_NAMES[symbol] || CORE_CURATED_NAMES[symbol] || symbol;
}

function curatedSource(code) {
  return ["CA", "IN", "IL", "SG", "ZA"].includes(code) ? "curated core legal-safe" : "curated";
}

function normalizeSearchText(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function canonicalSearchQuery(value = "") {
  const raw = String(value || "").trim().toUpperCase();
  const hk = raw.match(/^(\d{1,4})\.HK$/);
  return hk ? `${hk[1].padStart(4, "0")}.HK` : value;
}

export function exchangeLabel(symbol, country) {
  if (symbol.endsWith(".MC")) return "BME";
  if (symbol.endsWith(".DE")) return "XETRA";
  if (symbol.endsWith(".F")) return "Frankfurt";
  if (symbol.endsWith(".PA")) return "Euronext Paris";
  if (symbol.endsWith(".AS")) return "Euronext Amsterdam";
  if (symbol.endsWith(".L")) return "LSE";
  if (symbol.endsWith(".SW")) return "SIX";
  if (symbol.endsWith(".CO")) return "Copenhagen";
  if (symbol.endsWith(".ST")) return "Stockholm";
  if (symbol.endsWith(".OL")) return "Oslo";
  if (symbol.endsWith(".HE")) return "Helsinki";
  if (symbol.endsWith(".MI")) return "Milan";
  if (symbol.endsWith(".BR")) return "Brussels";
  if (symbol.endsWith(".LS")) return "Lisbon";
  if (symbol.endsWith(".VI")) return "Vienna";
  if (symbol.endsWith(".IR")) return "Euronext Dublin";
  if (symbol.endsWith(".TO")) return "Toronto";
  if (symbol.endsWith(".T")) return "Tokyo";
  if (symbol.endsWith(".HK")) return "Hong Kong";
  if (symbol.endsWith(".SI")) return "Singapore";
  if (symbol.endsWith(".JO")) return "Johannesburg";
  if (symbol.endsWith(".AX")) return "ASX";
  if (symbol.endsWith(".TW")) return "Taiwan";
  if (symbol.endsWith(".TA")) return "Tel Aviv";
  if (symbol.endsWith(".KS")) return "Korea Exchange";
  if (symbol.endsWith(".KQ")) return "KOSDAQ";
  if (symbol.endsWith(".NS")) return "NSE India";
  if (symbol.endsWith(".BO")) return "BSE India";
  if (symbol.endsWith(".SS")) return "Shanghai";
  if (symbol.endsWith(".SZ")) return "Shenzhen";
  if (symbol.endsWith(".SA")) return "B3 Brasil";
  if (symbol.endsWith(".MX")) return "Bolsa Mexicana";
  return country || "-";
}

export function searchCuratedCompanies(query) {
  const q = normalizeSearchText(canonicalSearchQuery(query)).trim();
  if (!q) return [];
  return universeEntries().flatMap(([country, list]) => list.map((symbol) => {
    const name = curatedName(symbol);
    const symbolText = normalizeSearchText(symbol);
    const nameText = normalizeSearchText(name);
    let score = 0;
    if (symbolText === q) score += 340;
    if (symbolText.startsWith(q)) score += 260;
    if (nameText === q) score += 340;
    if (nameText.startsWith(q)) score += 310;
    if (nameText.includes(q)) score += 250;
    if (symbolText.includes(q)) score += 160;
    return {
      symbol,
      name,
      exchange: exchangeLabel(symbol, country),
      exchangeCode: country,
      quoteType: "EQUITY",
      type: "equity",
      sector: "",
      industry: "",
      country,
      currency: "",
      marketCap: null,
      score,
      source: "curated",
    };
  })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
}

export async function fetchUSUniverse() {
  const urls = [
    "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt",
    "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
  ];
  const out = [];
  const failures = [];
  const timeoutMs = envNumber("NASDAQTRADER_TIMEOUT_MS", 5000, { min: 1000, max: 20000 });
  for (const url of urls) {
    const timeout = withTimeout(timeoutMs);
    let text = "";
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 86400 }, signal: timeout.signal });
      if (!res.ok) {
        failures.push(`${url} HTTP ${res.status}`);
        continue;
      }
      text = await res.text();
    } catch (error) {
      failures.push(`${url} ${error?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : error.message || "fetch failed"}`);
      continue;
    } finally {
      timeout.clear();
    }
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      failures.push(`${url} empty symbol directory`);
      continue;
    }
    const header = lines[0].split("|");
    for (const line of lines.slice(1)) {
      if (line.startsWith("File Creation Time")) continue;
      const parts = line.split("|");
      const row = Object.fromEntries(header.map((h, i) => [h, parts[i]]));
      const symbol = row.Symbol || row["ACT Symbol"] || row["NASDAQ Symbol"];
      const name = row["Security Name"] || "";
      const etf = row.ETF === "Y";
      const test = row["Test Issue"] === "Y";
      if (!symbol || etf || test) continue;
      if (symbol.includes("$") || symbol.includes("^")) continue;
      out.push({ symbol: symbol.replace(".", "-"), name, country: "US", source: "NasdaqTrader symbol directories" });
    }
  }
  if (!out.length && failures.length) throw new Error(`NasdaqTrader unavailable: ${failures.join("; ")}`);
  return Array.from(new Map(out.map((x) => [x.symbol, x])).values());
}

export async function getUniverse(market) {
  const code = String(market || "US").toUpperCase();
  if (code === "US") {
    let dynamic = [];
    if (!shouldSkipProviderFetch("US")) {
      dynamic = await fetchUSUniverse().catch((error) => {
        recordProviderFailure("US", error);
        return [];
      });
      if (dynamic.length) recordProviderSuccess("US", { count: dynamic.length });
      else recordProviderFailure("US", "NasdaqTrader symbol directories returned no rows");
    }
    const curated = marketSymbols(code).map((symbol) => ({ symbol, name: curatedName(symbol), country: code, source: "curated core legal-safe" }));
    const merged = new Map(curated.map((row) => [row.symbol, row]));
    for (const row of dynamic) {
      if (!merged.has(row.symbol)) merged.set(row.symbol, row);
    }
    return Array.from(merged.values());
  }
  if (code === "AU") {
    const dynamic = await fetchAsicShortUniverse().catch(() => []);
    const curated = marketSymbols(code).map((symbol) => ({ symbol, name: curatedName(symbol), country: code, source: "curated" }));
    return Array.from(new Map([...dynamic, ...curated].map((row) => [row.symbol, row])).values());
  }
  const official = await fetchOfficialMarketUniverse(code).catch(() => []);
  const curated = marketSymbols(code).map((symbol) => ({ symbol, name: curatedName(symbol), country: code, source: curatedSource(code) }));
  if (official.length || curated.length) return Array.from(new Map([...official, ...curated].map((row) => [row.symbol, row])).values());
  const list = marketSymbols(code);
  return list.map((symbol) => ({ symbol, name: curatedName(symbol), country: code, source: curatedSource(code) }));
}
