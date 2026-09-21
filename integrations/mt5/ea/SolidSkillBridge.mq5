//+------------------------------------------------------------------+
//|                                            SolidSkillBridge.mq5  |
//|                                                      Solid Skill |
//+------------------------------------------------------------------+
#property copyright   "Solid Skill"
#property version     "1.00"
#property description "Solid Skill MT5 Read-Only Bridge"
#property description "Observes account deals and forwards them to the local Solid Skill app."
#property description "This Expert Advisor contains no trading code and never trades."

//--- READ-ONLY INVARIANT -------------------------------------------------
// This EA observes the account. It never controls it. It has no code that
// sends, modifies, cancels, opens or closes anything, no #include, no
// #import (no DLLs), and no way to receive instructions: the socket is used
// for SENDING only and the program never reads from it.
// Enforced by a static scan in `npm run smoke:mt5`.
//-------------------------------------------------------------------------

input string InpHost                    = "127.0.0.1"; // Solid Skill address (loopback only)
input int    InpPort                    = 47615;       // Solid Skill bridge port
input string InpBridgeKey               = "";          // Optional local pairing key (not a broker password)
input int    InpHistoryLookbackDays     = 90;          // History replayed on connect (0 = all history)
input int    InpReconcileMinutes        = 15;          // Periodic short re-sync (0 = off)

#define SS_PROTOCOL_VERSION   1
#define SS_EA_VERSION         "1.0.0-spike"
#define SS_HEARTBEAT_MS       15000
#define SS_BACKOFF_MIN_MS     1000
#define SS_BACKOFF_MAX_MS     30000
#define SS_CONNECT_TIMEOUT_MS 1000
#define SS_RETRY_MAX_ATTEMPTS 5
#define SS_RECONCILE_DAYS     2
#define SS_MAX_FAILURE_REPORTS 10 // detailed DEAL_FETCH_FAILED reports per sync

#define SS_SEND_OK            0
#define SS_SEND_FETCH_FAILED  1
#define SS_SEND_SOCKET_FAILED 2

int      g_socket          = INVALID_HANDLE;
bool     g_connected       = false;
long     g_login           = 0;
string   g_server          = "";
ulong    g_nextAttemptMs   = 0;
ulong    g_backoffMs       = SS_BACKOFF_MIN_MS;
ulong    g_lastHeartbeatMs = 0;
ulong    g_lastReconcileMs = 0;
int      g_failedAttempts  = 0;
int      g_syncSeq         = 0;
ulong    g_retryTickets[];
int      g_retryAttempts[];

//+------------------------------------------------------------------+
//| JSON helpers                                                     |
//+------------------------------------------------------------------+
string JsonString(const string text)
  {
   string out="\"";
   int len=StringLen(text);
   for(int i=0;i<len;i++)
     {
      ushort c=StringGetCharacter(text,i);
      if(c=='"')
         out+="\\\"";
      else if(c=='\\')
         out+="\\\\";
      else if(c<32)
         out+=" ";
      else
         out+=ShortToString(c);
     }
   return out+"\"";
  }

string JsonStringOrNull(const string text)
  {
   if(StringLen(text)==0)
      return "null";
   return JsonString(text);
  }

// Decimal-safe text. Never a JSON number: the receiver rejects those.
string DecimalText(const double value)
  {
   return "\""+DoubleToString(value,8)+"\"";
  }

string DecimalOrNull(const bool available,const double value)
  {
   return available ? DecimalText(value) : "null";
  }

string UnsignedText(const ulong value)
  {
   return "\""+StringFormat("%I64u",value)+"\"";
  }

string SignedAsUnsignedText(const long value)
  {
   return "\""+(value<0 ? "0" : IntegerToString(value))+"\"";
  }

//+------------------------------------------------------------------+
//| Socket helpers (send-only)                                       |
//+------------------------------------------------------------------+
void Disconnect()
  {
   if(g_socket!=INVALID_HANDLE)
      SocketClose(g_socket);
   g_socket=INVALID_HANDLE;
   g_connected=false;
   ArrayResize(g_retryTickets,0);
   ArrayResize(g_retryAttempts,0);
  }

// Sends one newline-terminated JSON frame. Any failure closes the
// connection; the next reconnect replays history, so nothing is lost.
bool SendLine(const string json)
  {
   if(g_socket==INVALID_HANDLE)
      return false;
   uchar data[];
   int n=StringToCharArray(json+"\n",data,0,WHOLE_ARRAY,CP_UTF8);
   if(n<=1)
      return false;
   int total=n-1; // drop the terminating zero
   int sent=0;
   while(sent<total)
     {
      uchar rest[];
      ArrayCopy(rest,data,0,sent,total-sent);
      int written=SocketSend(g_socket,rest,(uint)(total-sent));
      if(written<=0)
        {
         Disconnect();
         return false;
        }
      sent+=written;
     }
   return true;
  }

//+------------------------------------------------------------------+
//| Messages                                                         |
//+------------------------------------------------------------------+
bool SendHello()
  {
   long   login   = AccountInfoInteger(ACCOUNT_LOGIN);
   string server  = AccountInfoString(ACCOUNT_SERVER);
   if(login<=0 || StringLen(server)==0)
      return false; // not connected to a trade server yet
   long   mode    = AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   long   tmode   = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   bool   hedging = (mode==ACCOUNT_MARGIN_MODE_RETAIL_HEDGING);
   g_login=login;
   g_server=server;

   string json="{\"v\":"+IntegerToString(SS_PROTOCOL_VERSION)+",\"type\":\"hello\",\"source\":\"MT5\"";
   json+=",\"eaVersion\":"+JsonString(SS_EA_VERSION);
   json+=",\"account\":{\"login\":"+SignedAsUnsignedText(login);
   json+=",\"server\":"+JsonString(server);
   json+=",\"company\":"+JsonStringOrNull(AccountInfoString(ACCOUNT_COMPANY));
   json+=",\"currency\":"+JsonString(AccountInfoString(ACCOUNT_CURRENCY));
   json+=",\"marginMode\":"+IntegerToString(mode);
   json+=",\"tradeMode\":"+IntegerToString(tmode);
   json+=",\"hedgeCapable\":"+(hedging ? "true" : "false")+"}";
   json+=",\"terminal\":{\"build\":"+IntegerToString(TerminalInfoInteger(TERMINAL_BUILD));
   json+=",\"name\":"+JsonStringOrNull(TerminalInfoString(TERMINAL_NAME))+"}";
   if(StringLen(InpBridgeKey)>0)
      json+=",\"bridgeKey\":"+JsonString(InpBridgeKey);
   json+="}";
   return SendLine(json);
  }

bool SendHeartbeat()
  {
   return SendLine("{\"v\":"+IntegerToString(SS_PROTOCOL_VERSION)+",\"type\":\"heartbeat\"}");
  }

// Diagnostics only: stage (failing MQL5 call / property) and GetLastError()
// of the most recent fetch failure. Never contains credentials or prices.
string g_failStage = "";
int    g_failError = 0;

bool SendError(const string code,const ulong dealTicket,const string detail,
               const string stage="",const int index=-1,const int lastError=-1)
  {
   string json="{\"v\":"+IntegerToString(SS_PROTOCOL_VERSION)+",\"type\":\"error\",\"code\":"+JsonString(code);
   json+=",\"dealTicket\":"+(dealTicket>0 ? UnsignedText(dealTicket) : "null");
   json+=",\"detail\":"+JsonStringOrNull(detail);
   json+=",\"stage\":"+JsonStringOrNull(stage);
   json+=",\"index\":"+(index>=0 ? IntegerToString(index) : "null");
   json+=",\"lastError\":"+(lastError>=0 ? IntegerToString(lastError) : "null")+"}";
   return SendLine(json);
  }

// Property readers. They read straight from `ticket` and NEVER call
// HistoryDealSelect (which would replace the selected history list).
bool ReadInt(const ulong ticket,const ENUM_DEAL_PROPERTY_INTEGER prop,const string name,long &value)
  {
   ResetLastError();
   if(HistoryDealGetInteger(ticket,prop,value))
      return true;
   g_failStage=name;
   g_failError=GetLastError();
   return false;
  }

bool ReadDouble(const ulong ticket,const ENUM_DEAL_PROPERTY_DOUBLE prop,const string name,double &value)
  {
   ResetLastError();
   if(HistoryDealGetDouble(ticket,prop,value))
      return true;
   g_failStage=name;
   g_failError=GetLastError();
   return false;
  }

// Reads the deal record of an ALREADY AVAILABLE ticket and sends one raw deal
// message. Precondition: the ticket came from HistoryDealGetTicket(i) over the
// current HistorySelect list, or the caller selected it (see SendLiveDeal).
// Facts only: no direction, no position grouping, no P&L math.
int SendDealProperties(const ulong ticket,const string origin,const string syncId)
  {
   long orderTicket=0,positionId=0,timeMsc=0,dealType=0,dealEntry=0,magic=0,reason=0;
   double volume=0.0,price=0.0;
   if(!ReadInt(ticket,DEAL_ORDER,"DEAL_ORDER",orderTicket) ||
      !ReadInt(ticket,DEAL_POSITION_ID,"DEAL_POSITION_ID",positionId) ||
      !ReadInt(ticket,DEAL_TIME_MSC,"DEAL_TIME_MSC",timeMsc) ||
      !ReadInt(ticket,DEAL_TYPE,"DEAL_TYPE",dealType) ||
      !ReadInt(ticket,DEAL_ENTRY,"DEAL_ENTRY",dealEntry) ||
      !ReadInt(ticket,DEAL_MAGIC,"DEAL_MAGIC",magic) ||
      !ReadInt(ticket,DEAL_REASON,"DEAL_REASON",reason) ||
      !ReadDouble(ticket,DEAL_VOLUME,"DEAL_VOLUME",volume) ||
      !ReadDouble(ticket,DEAL_PRICE,"DEAL_PRICE",price))
      return SS_SEND_FETCH_FAILED;

   // Optional properties: a failed read is reported as null, never as 0.
   double profit=0.0,commission=0.0,fee=0.0,swap=0.0;
   bool hasProfit=HistoryDealGetDouble(ticket,DEAL_PROFIT,profit);
   bool hasCommission=HistoryDealGetDouble(ticket,DEAL_COMMISSION,commission);
   bool hasFee=HistoryDealGetDouble(ticket,DEAL_FEE,fee);
   bool hasSwap=HistoryDealGetDouble(ticket,DEAL_SWAP,swap);
   string symbol="",externalId="";
   HistoryDealGetString(ticket,DEAL_SYMBOL,symbol);
   HistoryDealGetString(ticket,DEAL_EXTERNAL_ID,externalId);

   string json="{\"v\":"+IntegerToString(SS_PROTOCOL_VERSION)+",\"type\":\"deal\",\"source\":\"MT5\"";
   json+=",\"origin\":"+JsonString(origin);
   json+=",\"syncId\":"+(StringLen(syncId)>0 ? JsonString(syncId) : "null");
   json+=",\"server\":"+JsonString(g_server);
   json+=",\"accountLogin\":"+SignedAsUnsignedText(g_login);
   json+=",\"dealTicket\":"+UnsignedText(ticket);
   json+=",\"orderTicket\":"+SignedAsUnsignedText(orderTicket);
   json+=",\"positionId\":"+SignedAsUnsignedText(positionId);
   json+=",\"externalId\":"+JsonStringOrNull(externalId);
   json+=",\"timeMsc\":"+IntegerToString(timeMsc);
   json+=",\"symbol\":"+JsonStringOrNull(symbol);
   json+=",\"dealType\":"+IntegerToString(dealType);
   json+=",\"dealEntry\":"+IntegerToString(dealEntry);
   json+=",\"volume\":"+DecimalText(volume);
   json+=",\"price\":"+DecimalText(price);
   json+=",\"profit\":"+DecimalOrNull(hasProfit,profit);
   json+=",\"commission\":"+DecimalOrNull(hasCommission,commission);
   json+=",\"fee\":"+DecimalOrNull(hasFee,fee);
   json+=",\"swap\":"+DecimalOrNull(hasSwap,swap);
   json+=",\"magic\":"+SignedAsUnsignedText(magic);
   json+=",\"reason\":"+IntegerToString(reason)+"}";
   return SendLine(json) ? SS_SEND_OK : SS_SEND_SOCKET_FAILED;
  }

// LIVE path (OnTradeTransaction / retry queue), deliberately separate from the
// history loop: here there is no selected list to preserve, so the deal is
// selected by ticket first. Never call this from inside a HistorySelect loop.
int SendLiveDeal(const ulong ticket)
  {
   ResetLastError();
   if(!HistoryDealSelect(ticket))
     {
      g_failStage="HistoryDealSelect";
      g_failError=GetLastError();
      return SS_SEND_FETCH_FAILED;
     }
   return SendDealProperties(ticket,"live","");
  }

//+------------------------------------------------------------------+
//| History reconciliation                                           |
//+------------------------------------------------------------------+
// HistorySelect -> capture HistoryDealsTotal -> for each ORIGINAL index:
// HistoryDealGetTicket(index) -> read that ticket's properties directly.
// HistoryDealSelect must never be called inside this loop: it replaces the
// selected list with one deal and every later index would fail.
// The receiver dedups by (MT5, server, login, deal ticket), so replaying is
// always harmless.
// NOTE: runs inside OnTimer and blocks the EA thread while it iterates.
void ReportHistoryFailure(const int failedSoFar,const ulong ticket,const int index,
                          const string stage,const int lastError)
  {
   // Bounded: the first few failures are detailed, the rest are only counted
   // (the final history_end carries the exact totals).
   if(failedSoFar>SS_MAX_FAILURE_REPORTS)
      return;
   Print("[SolidSkill] DEAL_FETCH_FAILED stage=",stage," index=",index," ticket=",ticket," lastError=",lastError);
   SendError("DEAL_FETCH_FAILED",ticket,"history deal could not be read",stage,index,lastError);
   if(failedSoFar==SS_MAX_FAILURE_REPORTS)
      Print("[SolidSkill] Further DEAL_FETCH_FAILED details suppressed for this sync; totals follow.");
  }

bool SyncHistory(const int days)
  {
   datetime from=0;
   if(days>0)
      from=TimeCurrent()-(datetime)((long)days*86400);
   ResetLastError();
   if(!HistorySelect(from,TimeCurrent()+86400))
     {
      int selectError=GetLastError();
      Print("[SolidSkill] HistorySelect failed, lastError=",selectError);
      SendError("HISTORY_SELECT_FAILED",0,"HistorySelect failed","HistorySelect",-1,selectError);
      return false;
     }
   g_syncSeq++;
   string syncId=IntegerToString((long)TimeGMT())+"-"+IntegerToString(g_syncSeq);
   string prefix="{\"v\":"+IntegerToString(SS_PROTOCOL_VERSION)+",\"type\":\"history_";
   if(!SendLine(prefix+"begin\",\"syncId\":"+JsonString(syncId)+"}"))
      return false;

   const int discovered=HistoryDealsTotal();
   int sentCount=0;
   int failedCount=0;
   for(int i=0;i<discovered;i++)
     {
      g_failStage="";
      g_failError=0;
      ResetLastError();
      ulong ticket=HistoryDealGetTicket(i);
      if(ticket==0)
        {
         failedCount++;
         ReportHistoryFailure(failedCount,0,i,"HistoryDealGetTicket",GetLastError());
         continue;
        }
      int result=SendDealProperties(ticket,"history",syncId);
      if(result==SS_SEND_SOCKET_FAILED)
         return false;
      if(result==SS_SEND_FETCH_FAILED)
        {
         failedCount++;
         ReportHistoryFailure(failedCount,ticket,i,g_failStage,g_failError);
         continue;
        }
      sentCount++;
     }
   Print("[SolidSkill] History sync ",(failedCount==0 && sentCount==discovered ? "complete" : "INCOMPLETE"),
         ": discovered ",discovered,", sent ",sentCount,", failed ",failedCount);
   return SendLine(prefix+"end\",\"syncId\":"+JsonString(syncId)+
                   ",\"discovered\":"+IntegerToString(discovered)+
                   ",\"sent\":"+IntegerToString(sentCount)+
                   ",\"failed\":"+IntegerToString(failedCount)+"}");
  }

//+------------------------------------------------------------------+
//| Live retry queue (deals MT5 could not yet return from history)   |
//+------------------------------------------------------------------+
void QueueRetry(const ulong ticket)
  {
   int n=ArraySize(g_retryTickets);
   for(int i=0;i<n;i++)
      if(g_retryTickets[i]==ticket)
         return;
   ArrayResize(g_retryTickets,n+1);
   ArrayResize(g_retryAttempts,n+1);
   g_retryTickets[n]=ticket;
   g_retryAttempts[n]=0;
  }

void ProcessRetryQueue()
  {
   for(int i=ArraySize(g_retryTickets)-1;i>=0 && g_connected;i--)
     {
      int result=SendLiveDeal(g_retryTickets[i]);
      bool remove=(result==SS_SEND_OK);
      if(result==SS_SEND_FETCH_FAILED && ++g_retryAttempts[i]>=SS_RETRY_MAX_ATTEMPTS)
        {
         // Give up live; the periodic/reconnect history sync will reconcile it.
         SendError("DEAL_FETCH_FAILED",g_retryTickets[i],"live deal not readable after retries",g_failStage,-1,g_failError);
         remove=true;
        }
      if(remove && i<ArraySize(g_retryTickets))
        {
         int last=ArraySize(g_retryTickets)-1;
         g_retryTickets[i]=g_retryTickets[last];
         g_retryAttempts[i]=g_retryAttempts[last];
         ArrayResize(g_retryTickets,last);
         ArrayResize(g_retryAttempts,last);
        }
     }
  }

//+------------------------------------------------------------------+
//| Connection management                                            |
//+------------------------------------------------------------------+
void TryConnect(const ulong nowMs)
  {
   g_socket=SocketCreate();
   if(g_socket==INVALID_HANDLE)
     {
      Print("[SolidSkill] SocketCreate failed, error ",GetLastError());
     }
   else if(!SocketConnect(g_socket,InpHost,(uint)InpPort,SS_CONNECT_TIMEOUT_MS))
     {
      int err=GetLastError();
      SocketClose(g_socket);
      g_socket=INVALID_HANDLE;
      // Solid Skill not running is normal: log the first failure, then rarely.
      if(g_failedAttempts==0 || g_failedAttempts%20==0)
         Print("[SolidSkill] Solid Skill not reachable at ",InpHost,":",InpPort,
               " (error ",err,"). Will keep retrying. If Solid Skill is running, check Tools > Options > Expert Advisors allowed addresses.");
     }
   else if(!SendHello())
     {
      Disconnect();
      Print("[SolidSkill] Connected but account is not ready yet (no trade server). Retrying.");
     }
   else
     {
      g_connected=true;
      g_failedAttempts=0;
      g_backoffMs=SS_BACKOFF_MIN_MS;
      g_lastHeartbeatMs=nowMs;
      g_lastReconcileMs=nowMs;
      Print("[SolidSkill] Connected to Solid Skill at ",InpHost,":",InpPort," (read-only, account ",g_login,")");
      // SyncHistory prints its own truthful discovered/sent/failed summary.
      if(!SyncHistory(InpHistoryLookbackDays) && g_connected)
         Print("[SolidSkill] History sync could not start; will retry on the next reconcile");
      return;
     }
   g_failedAttempts++;
   g_nextAttemptMs=nowMs+g_backoffMs;
   g_backoffMs=MathMin(g_backoffMs*2,(ulong)SS_BACKOFF_MAX_MS);
  }

//+------------------------------------------------------------------+
//| Expert lifecycle                                                 |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(MQLInfoInteger(MQL_TESTER))
     {
      Print("[SolidSkill] Not supported in the Strategy Tester.");
      return INIT_FAILED;
     }
   // Defense in depth: this EA only ever talks to the local machine.
   if(InpHost!="127.0.0.1" && InpHost!="localhost" && InpHost!="::1")
     {
      Print("[SolidSkill] InpHost must be a loopback address (127.0.0.1).");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpPort<1 || InpPort>65535)
     {
      Print("[SolidSkill] InpPort is out of range.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(!EventSetTimer(1))
     {
      Print("[SolidSkill] EventSetTimer failed, error ",GetLastError());
      return INIT_FAILED;
     }
   Print("[SolidSkill] Solid Skill MT5 Read-Only Bridge ",SS_EA_VERSION," started. This EA never trades.");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Disconnect();
   Print("[SolidSkill] Bridge stopped.");
  }

// Lightweight by design: identify the deal ticket, read the authoritative
// record from history, send one frame. Transactions can arrive in any
// order; nothing is reconstructed here.
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD || trans.deal==0)
      return;
   if(!g_connected)
      return; // the history sync on reconnect will deliver it
   if(SendLiveDeal(trans.deal)==SS_SEND_FETCH_FAILED)
      QueueRetry(trans.deal); // history not ready yet; retried from OnTimer
  }

void OnTimer()
  {
   ulong nowMs=GetTickCount64();
   if(g_connected)
     {
      if(AccountInfoInteger(ACCOUNT_LOGIN)!=g_login)
        {
         Print("[SolidSkill] Terminal account changed; reconnecting.");
         Disconnect();
         g_nextAttemptMs=0;
         return;
        }
      ProcessRetryQueue();
      if(g_connected && nowMs-g_lastHeartbeatMs>=SS_HEARTBEAT_MS)
        {
         g_lastHeartbeatMs=nowMs;
         SendHeartbeat();
        }
      if(g_connected && InpReconcileMinutes>0 &&
         nowMs-g_lastReconcileMs>=(ulong)InpReconcileMinutes*60000)
        {
         g_lastReconcileMs=nowMs;
         SyncHistory(SS_RECONCILE_DAYS);
        }
      return;
     }
   if(nowMs>=g_nextAttemptMs)
      TryConnect(nowMs);
  }
//+------------------------------------------------------------------+
