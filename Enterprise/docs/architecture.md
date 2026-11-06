# Enterprise architecture

Generated from DSL by `highscript diagram`, do not edit. In diagrams:

- rectangles are units with their level, rounded boxes are components; grey parts are not exposed by their unit, dashed parts are declared in DSL without code
- ovals are actors; double-bordered boxes are other parts of the model, drawn at the level where they meet the unit; hexagons are required contracts without a provider
- `==>` is a call through a transport (contract, version, transport), `-->` is a use in process (port name when it differs), `-.->` is the adapter given by `via`; an arrow that crosses the boundary is drawn on the boundary and names the part inside

## Landscape

Enterprise with its parts expanded one level deeper.

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v0_actor_Accountant(["Accountant"]):::actor
  v0_actor_Customer(["Customer"]):::actor
  v0_actor_Merchant(["Merchant"]):::actor
  v0_actor_Administrator(["Administrator"]):::actor
  v0_actor_Operator(["Operator"]):::actor
  subgraph v0_Enterprise ["Enterprise#160;·#160;enterprise"]
    direction TB
    subgraph v0_Enterprise_PaymentSystem ["PaymentSystem#160;·#160;solution"]
      direction TB
      v0_Enterprise_PaymentSystem_WebClient["WebClient<br/>application"]:::unit
      v0_Enterprise_PaymentSystem_MobileClient["MobileClient<br/>application · no code"]:::missing
      v0_Enterprise_PaymentSystem_Terminal["Terminal<br/>application · no code"]:::missing
      v0_Enterprise_PaymentSystem_PaymentProcessing["PaymentProcessing<br/>application"]:::unit
    end
    subgraph v0_Enterprise_CurrencyExchange ["CurrencyExchange#160;·#160;solution"]
      direction TB
      v0_Enterprise_CurrencyExchange_ExchangeMock["ExchangeMock<br/>application"]:::unit
    end
    subgraph v0_Enterprise_PaymentGateway ["PaymentGateway#160;·#160;solution"]
      direction TB
      v0_Enterprise_PaymentGateway_GatewayMock["GatewayMock<br/>application"]:::unit
    end
  end
  v0_actor_Operator -->|"GatewayMock"| v0_Enterprise
  v0_Enterprise_PaymentGateway_GatewayMock ==>|"handleWebhook<br/>http-webhook"| v0_Enterprise_PaymentSystem_PaymentProcessing
  v0_actor_Customer -->|"WebClient, MobileClient"| v0_Enterprise
  v0_actor_Merchant -->|"WebClient, Terminal"| v0_Enterprise
  v0_actor_Administrator -->|"Terminal"| v0_Enterprise
  v0_actor_Accountant -->|"WebClient"| v0_Enterprise
  v0_Enterprise_PaymentSystem_MobileClient ==>|"Payments v1<br/>http-json"| v0_Enterprise_PaymentSystem_PaymentProcessing
  v0_Enterprise_PaymentSystem_PaymentProcessing ==>|"PaymentGateway v1<br/>http-json"| v0_Enterprise_PaymentGateway_GatewayMock
  v0_Enterprise_PaymentSystem_PaymentProcessing ==>|"CurrencyExchange v1<br/>http-json"| v0_Enterprise_CurrencyExchange_ExchangeMock
  v0_Enterprise_PaymentSystem_Terminal ==>|"Payments v1<br/>http-json"| v0_Enterprise_PaymentSystem_PaymentProcessing
  v0_Enterprise_PaymentSystem_WebClient ==>|"Payments v2<br/>http-json"| v0_Enterprise_PaymentSystem_PaymentProcessing
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```

## Enterprise

enterprise, `Enterprise/enterprise.js`

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v1_actor_Customer(["Customer"]):::actor
  v1_actor_Merchant(["Merchant"]):::actor
  v1_actor_Administrator(["Administrator"]):::actor
  v1_actor_Accountant(["Accountant"]):::actor
  v1_actor_Operator(["Operator"]):::actor
  subgraph v1_Enterprise ["Enterprise#160;·#160;enterprise"]
    direction TB
    v1_Enterprise_PaymentSystem["PaymentSystem<br/>solution"]:::unit
    v1_Enterprise_CurrencyExchange["CurrencyExchange<br/>solution"]:::internal
    v1_Enterprise_PaymentGateway["PaymentGateway<br/>solution"]:::internal
  end
  v1_actor_Operator -->|"PaymentGateway"| v1_Enterprise
  v1_Enterprise_PaymentGateway ==>|"handleWebhook<br/>http-webhook"| v1_Enterprise_PaymentSystem
  v1_actor_Customer -->|"PaymentSystem"| v1_Enterprise
  v1_actor_Merchant -->|"PaymentSystem"| v1_Enterprise
  v1_actor_Administrator -->|"PaymentSystem"| v1_Enterprise
  v1_actor_Accountant -->|"PaymentSystem"| v1_Enterprise
  v1_Enterprise_PaymentSystem ==>|"PaymentGateway v1<br/>http-json"| v1_Enterprise_PaymentGateway
  v1_Enterprise_PaymentSystem ==>|"CurrencyExchange v1<br/>http-json"| v1_Enterprise_CurrencyExchange
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```

## Enterprise.PaymentSystem

solution, `Enterprise/PaymentSystem/solution.js`

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v2_actor_Accountant(["Accountant"]):::actor
  v2_actor_Customer(["Customer"]):::actor
  v2_actor_Merchant(["Merchant"]):::actor
  v2_actor_Administrator(["Administrator"]):::actor
  subgraph v2_Enterprise_PaymentSystem ["PaymentSystem#160;·#160;solution"]
    direction TB
    v2_Enterprise_PaymentSystem_WebClient["WebClient<br/>application"]:::unit
    v2_Enterprise_PaymentSystem_MobileClient["MobileClient<br/>application · no code"]:::missing
    v2_Enterprise_PaymentSystem_Terminal["Terminal<br/>application · no code"]:::missing
    v2_Enterprise_PaymentSystem_PaymentProcessing["PaymentProcessing<br/>application"]:::unit
  end
  v2_Enterprise_PaymentGateway[["PaymentGateway<br/>solution"]]:::external
  v2_Enterprise_CurrencyExchange[["CurrencyExchange<br/>solution"]]:::external
  v2_Enterprise_PaymentGateway ==>|"PaymentProcessing<br/>handleWebhook<br/>http-webhook"| v2_Enterprise_PaymentSystem
  v2_actor_Customer -->|"WebClient, MobileClient"| v2_Enterprise_PaymentSystem
  v2_actor_Merchant -->|"WebClient, Terminal"| v2_Enterprise_PaymentSystem
  v2_actor_Administrator -->|"Terminal"| v2_Enterprise_PaymentSystem
  v2_actor_Accountant -->|"WebClient"| v2_Enterprise_PaymentSystem
  v2_Enterprise_PaymentSystem_MobileClient ==>|"Payments v1<br/>http-json"| v2_Enterprise_PaymentSystem_PaymentProcessing
  v2_Enterprise_PaymentSystem ==>|"PaymentProcessing<br/>PaymentGateway v1<br/>http-json"| v2_Enterprise_PaymentGateway
  v2_Enterprise_PaymentSystem ==>|"PaymentProcessing<br/>CurrencyExchange v1<br/>http-json"| v2_Enterprise_CurrencyExchange
  v2_Enterprise_PaymentSystem_Terminal ==>|"Payments v1<br/>http-json"| v2_Enterprise_PaymentSystem_PaymentProcessing
  v2_Enterprise_PaymentSystem_WebClient ==>|"Payments v2<br/>http-json"| v2_Enterprise_PaymentSystem_PaymentProcessing
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```

## Enterprise.PaymentSystem.WebClient

application, `Enterprise/PaymentSystem/WebClient/application.js`

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v3_actor_Customer(["Customer"]):::actor
  v3_actor_Merchant(["Merchant"]):::actor
  v3_actor_Accountant(["Accountant"]):::actor
  subgraph v3_Enterprise_PaymentSystem_WebClient ["WebClient#160;·#160;application"]
    direction TB
    v3_Enterprise_PaymentSystem_WebClient_ui("ui<br/>component"):::component
    v3_Enterprise_PaymentSystem_WebClient_transport("transport<br/>component"):::internal
  end
  v3_Enterprise_PaymentSystem_PaymentProcessing[["PaymentProcessing<br/>application"]]:::external
  v3_actor_Customer --> v3_Enterprise_PaymentSystem_WebClient
  v3_actor_Merchant --> v3_Enterprise_PaymentSystem_WebClient
  v3_actor_Accountant --> v3_Enterprise_PaymentSystem_WebClient
  v3_Enterprise_PaymentSystem_WebClient -.->|"transport<br/>via"| v3_Enterprise_PaymentSystem_PaymentProcessing
  v3_Enterprise_PaymentSystem_WebClient ==>|"ui<br/>Payments v2<br/>http-json"| v3_Enterprise_PaymentSystem_PaymentProcessing
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```

## Enterprise.PaymentSystem.MobileClient

application, `Enterprise/PaymentSystem/MobileClient/application.js`

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v4_actor_Customer(["Customer"]):::actor
  subgraph v4_Enterprise_PaymentSystem_MobileClient ["MobileClient#160;·#160;application"]
    direction TB
    v4_Enterprise_PaymentSystem_MobileClient_ui("ui<br/>no code"):::missing
  end
  v4_Enterprise_PaymentSystem_PaymentProcessing[["PaymentProcessing<br/>application"]]:::external
  v4_actor_Customer --> v4_Enterprise_PaymentSystem_MobileClient
  v4_Enterprise_PaymentSystem_MobileClient ==>|"ui<br/>Payments v1<br/>http-json"| v4_Enterprise_PaymentSystem_PaymentProcessing
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```

## Enterprise.PaymentSystem.Terminal

application, `Enterprise/PaymentSystem/Terminal/application.js`

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v5_actor_Merchant(["Merchant"]):::actor
  v5_actor_Administrator(["Administrator"]):::actor
  subgraph v5_Enterprise_PaymentSystem_Terminal ["Terminal#160;·#160;application"]
    direction TB
    v5_Enterprise_PaymentSystem_Terminal_cli("cli<br/>no code"):::missing
  end
  v5_Enterprise_PaymentSystem_PaymentProcessing[["PaymentProcessing<br/>application"]]:::external
  v5_actor_Merchant --> v5_Enterprise_PaymentSystem_Terminal
  v5_actor_Administrator --> v5_Enterprise_PaymentSystem_Terminal
  v5_Enterprise_PaymentSystem_Terminal ==>|"cli<br/>Payments v1<br/>http-json"| v5_Enterprise_PaymentSystem_PaymentProcessing
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```

## Enterprise.PaymentSystem.PaymentProcessing

application, `Enterprise/PaymentSystem/PaymentProcessing/application.js`

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v6_Enterprise_PaymentSystem_MobileClient[["MobileClient<br/>application · no code"]]:::external
  v6_Enterprise_PaymentSystem_Terminal[["Terminal<br/>application · no code"]]:::external
  v6_Enterprise_PaymentSystem_WebClient[["WebClient<br/>application"]]:::external
  subgraph v6_Enterprise_PaymentSystem_PaymentProcessing ["PaymentProcessing#160;·#160;application"]
    direction TB
    v6_Enterprise_PaymentSystem_PaymentProcessing_server("server<br/>Payments · http-json"):::component
    v6_Enterprise_PaymentSystem_PaymentProcessing_webhook("webhook<br/>handleWebhook · http-webhook"):::component
    v6_Enterprise_PaymentSystem_PaymentProcessing_exchange("exchange<br/>component"):::internal
    v6_Enterprise_PaymentSystem_PaymentProcessing_gateway("gateway<br/>component"):::internal
    v6_Enterprise_PaymentSystem_PaymentProcessing_logger("logger<br/>component"):::internal
    v6_Enterprise_PaymentSystem_PaymentProcessing_PaymentService["PaymentService<br/>service"]:::internal
  end
  v6_Enterprise_CurrencyExchange[["CurrencyExchange<br/>solution"]]:::external
  v6_Enterprise_PaymentGateway[["PaymentGateway<br/>solution"]]:::external
  v6_Enterprise_PaymentGateway ==>|"webhook<br/>handleWebhook<br/>http-webhook"| v6_Enterprise_PaymentSystem_PaymentProcessing
  v6_Enterprise_PaymentSystem_MobileClient ==>|"server<br/>Payments v1<br/>http-json"| v6_Enterprise_PaymentSystem_PaymentProcessing
  v6_Enterprise_PaymentSystem_PaymentProcessing -.->|"gateway<br/>via"| v6_Enterprise_PaymentGateway
  v6_Enterprise_PaymentSystem_PaymentProcessing -.->|"exchange<br/>via"| v6_Enterprise_CurrencyExchange
  v6_Enterprise_PaymentSystem_PaymentProcessing_server --> v6_Enterprise_PaymentSystem_PaymentProcessing_logger
  v6_Enterprise_PaymentSystem_PaymentProcessing_server -->|"api"| v6_Enterprise_PaymentSystem_PaymentProcessing_PaymentService
  v6_Enterprise_PaymentSystem_PaymentProcessing_webhook --> v6_Enterprise_PaymentSystem_PaymentProcessing_server
  v6_Enterprise_PaymentSystem_PaymentProcessing_webhook --> v6_Enterprise_PaymentSystem_PaymentProcessing_logger
  v6_Enterprise_PaymentSystem_PaymentProcessing_webhook -->|"handler"| v6_Enterprise_PaymentSystem_PaymentProcessing_PaymentService
  v6_Enterprise_PaymentSystem_PaymentProcessing_webhook -->|"verify"| v6_Enterprise_PaymentSystem_PaymentProcessing_gateway
  v6_Enterprise_PaymentSystem_PaymentProcessing_exchange --> v6_Enterprise_PaymentSystem_PaymentProcessing_logger
  v6_Enterprise_PaymentSystem_PaymentProcessing_gateway --> v6_Enterprise_PaymentSystem_PaymentProcessing_logger
  v6_Enterprise_PaymentSystem_PaymentProcessing ==>|"PaymentService<br/>PaymentGateway v1<br/>http-json"| v6_Enterprise_PaymentGateway
  v6_Enterprise_PaymentSystem_PaymentProcessing ==>|"PaymentService<br/>CurrencyExchange v1<br/>http-json"| v6_Enterprise_CurrencyExchange
  v6_Enterprise_PaymentSystem_PaymentProcessing_PaymentService --> v6_Enterprise_PaymentSystem_PaymentProcessing_logger
  v6_Enterprise_PaymentSystem_Terminal ==>|"server<br/>Payments v1<br/>http-json"| v6_Enterprise_PaymentSystem_PaymentProcessing
  v6_Enterprise_PaymentSystem_WebClient ==>|"server<br/>Payments v2<br/>http-json"| v6_Enterprise_PaymentSystem_PaymentProcessing
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```

## Enterprise.PaymentSystem.PaymentProcessing.PaymentService

service, `Enterprise/PaymentSystem/PaymentProcessing/PaymentService/service.js`

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v7_Enterprise_PaymentSystem_PaymentProcessing_server[["PaymentProcessing.server<br/>Payments · http-json"]]:::external
  v7_Enterprise_PaymentSystem_PaymentProcessing_webhook[["PaymentProcessing.webhook<br/>handleWebhook · http-webhook"]]:::external
  subgraph v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService ["PaymentService#160;·#160;service"]
    direction LR
    v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_createPayment("createPayment<br/>Payments v2"):::component
    v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_confirmPayment("confirmPayment<br/>Payments v2"):::component
    v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_cancelPayment("cancelPayment<br/>Payments v2"):::component
    v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_refundPayment("refundPayment<br/>Payments v2"):::component
    v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_getPaymentStatus("getPaymentStatus<br/>Payments v2"):::component
    v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_getTransactionHistory("getTransactionHistory<br/>Payments v2"):::component
    v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_managePaymentMethods("managePaymentMethods<br/>Payments v2"):::component
    v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_handleWebhook("handleWebhook<br/>handleWebhook"):::component
    v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_normalizePayment("normalizePayment<br/>component"):::internal
    v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence["persistence<br/>component"]:::internal
  end
  v7_Enterprise_CurrencyExchange[["CurrencyExchange<br/>solution"]]:::external
  v7_Enterprise_PaymentGateway[["PaymentGateway<br/>solution"]]:::external
  v7_Enterprise_PaymentSystem_PaymentProcessing_logger[["PaymentProcessing.logger<br/>component"]]:::external
  v7_Enterprise_PaymentSystem_PaymentProcessing_server -->|"api"| v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService
  v7_Enterprise_PaymentSystem_PaymentProcessing_webhook -->|"handleWebhook<br/>handler"| v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService
  v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_createPayment -->|"payments"| v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService ==>|"createPayment, confirmPayment, cancelPayment<br/>refundPayment, managePaymentMethods<br/>PaymentGateway v1<br/>http-json"| v7_Enterprise_PaymentGateway
  v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService ==>|"createPayment<br/>CurrencyExchange v1<br/>http-json"| v7_Enterprise_CurrencyExchange
  v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_createPayment -->|"normalize"| v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_normalizePayment
  v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService -->|"createPayment, confirmPayment, cancelPayment<br/>refundPayment, handleWebhook, persistence"| v7_Enterprise_PaymentSystem_PaymentProcessing_logger
  v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_confirmPayment -->|"payments"| v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_cancelPayment -->|"payments"| v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_refundPayment -->|"payments"| v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_getPaymentStatus -->|"payments"| v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_getTransactionHistory -->|"payments"| v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_handleWebhook -->|"payments"| v7_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```

## Enterprise.PaymentSystem.PaymentProcessing.PaymentService.persistence

component, `Enterprise/PaymentSystem/PaymentProcessing/PaymentService/persistence/component.js`

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_createPayment[["PaymentService.createPayment<br/>Payments v2"]]:::external
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_confirmPayment[["PaymentService.confirmPayment<br/>Payments v2"]]:::external
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_cancelPayment[["PaymentService.cancelPayment<br/>Payments v2"]]:::external
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_refundPayment[["PaymentService.refundPayment<br/>Payments v2"]]:::external
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_getPaymentStatus[["PaymentService.getPaymentStatus<br/>Payments v2"]]:::external
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_getTransactionHistory[["PaymentService.getTransactionHistory<br/>Payments v2"]]:::external
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_handleWebhook[["PaymentService.handleWebhook<br/>handleWebhook"]]:::external
  subgraph v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence ["persistence#160;·#160;component"]
    direction TB
    v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence_Repository("Repository<br/>component"):::component
    v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence_database("database<br/>component"):::internal
  end
  v8_Enterprise_PaymentSystem_PaymentProcessing_logger[["PaymentProcessing.logger<br/>component"]]:::external
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_createPayment -->|"Repository<br/>payments"| v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_confirmPayment -->|"Repository<br/>payments"| v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_cancelPayment -->|"Repository<br/>payments"| v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_refundPayment -->|"Repository<br/>payments"| v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_getPaymentStatus -->|"Repository<br/>payments"| v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_getTransactionHistory -->|"Repository<br/>payments"| v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_handleWebhook -->|"Repository<br/>payments"| v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence_Repository --> v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence_database
  v8_Enterprise_PaymentSystem_PaymentProcessing_PaymentService_persistence -->|"database"| v8_Enterprise_PaymentSystem_PaymentProcessing_logger
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```

## Enterprise.CurrencyExchange

solution, `Enterprise/CurrencyExchange/solution.md`

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v9_Enterprise_PaymentSystem[["PaymentSystem<br/>solution"]]:::external
  subgraph v9_Enterprise_CurrencyExchange ["CurrencyExchange#160;·#160;solution"]
    direction TB
    v9_Enterprise_CurrencyExchange_ExchangeMock["ExchangeMock<br/>application"]:::unit
  end
  v9_Enterprise_PaymentSystem ==>|"ExchangeMock<br/>CurrencyExchange v1<br/>http-json"| v9_Enterprise_CurrencyExchange
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```

## Enterprise.CurrencyExchange.ExchangeMock

application, `Enterprise/CurrencyExchange/ExchangeMock/application.md`

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v10_Enterprise_PaymentSystem[["PaymentSystem<br/>solution"]]:::external
  subgraph v10_Enterprise_CurrencyExchange_ExchangeMock ["ExchangeMock#160;·#160;application"]
    direction TB
    v10_Enterprise_CurrencyExchange_ExchangeMock_server("server<br/>CurrencyExchange · http-json"):::component
    v10_Enterprise_CurrencyExchange_ExchangeMock_database("database<br/>component"):::internal
    v10_Enterprise_CurrencyExchange_ExchangeMock_logger("logger<br/>component"):::internal
    v10_Enterprise_CurrencyExchange_ExchangeMock_rates("rates<br/>component"):::internal
  end
  v10_Enterprise_CurrencyExchange_ExchangeMock_server --> v10_Enterprise_CurrencyExchange_ExchangeMock_logger
  v10_Enterprise_CurrencyExchange_ExchangeMock_server -->|"api"| v10_Enterprise_CurrencyExchange_ExchangeMock_rates
  v10_Enterprise_CurrencyExchange_ExchangeMock_database --> v10_Enterprise_CurrencyExchange_ExchangeMock_logger
  v10_Enterprise_CurrencyExchange_ExchangeMock_rates --> v10_Enterprise_CurrencyExchange_ExchangeMock_database
  v10_Enterprise_CurrencyExchange_ExchangeMock_rates --> v10_Enterprise_CurrencyExchange_ExchangeMock_logger
  v10_Enterprise_PaymentSystem ==>|"server<br/>CurrencyExchange v1<br/>http-json"| v10_Enterprise_CurrencyExchange_ExchangeMock
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```

## Enterprise.PaymentGateway

solution, `Enterprise/PaymentGateway/solution.lisp`

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v11_actor_Operator(["Operator"]):::actor
  subgraph v11_Enterprise_PaymentGateway ["PaymentGateway#160;·#160;solution"]
    direction TB
    v11_Enterprise_PaymentGateway_GatewayMock["GatewayMock<br/>application"]:::unit
  end
  v11_Enterprise_PaymentSystem[["PaymentSystem<br/>solution"]]:::external
  v11_actor_Operator -->|"GatewayMock"| v11_Enterprise_PaymentGateway
  v11_Enterprise_PaymentGateway ==>|"GatewayMock<br/>handleWebhook<br/>http-webhook"| v11_Enterprise_PaymentSystem
  v11_Enterprise_PaymentSystem ==>|"GatewayMock<br/>PaymentGateway v1<br/>http-json"| v11_Enterprise_PaymentGateway
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```

## Enterprise.PaymentGateway.GatewayMock

application, `Enterprise/PaymentGateway/GatewayMock/application.lisp`

```mermaid
%%{init: {"look":"classic","flowchart":{"curve":"bumpX","nodeSpacing":28,"rankSpacing":56,"padding":14,"look":"classic"},"themeVariables":{"lineColor":"#6b7586","arrowheadColor":"#6b7586","fontFamily":"ui-sans-serif, system-ui, sans-serif","clusterBkg":"transparent","clusterBorder":"#c5ced9","edgeLabelBackground":"transparent","nodeShadow":false,"dropShadow":"none"},"themeCSS":".labelBkg,.edgeLabel span,.edgeLabel p{background-color:var(--bgColor-default,Canvas)!important;}.node rect,.node circle,.node ellipse,.node polygon,.node path,.cluster rect,[data-look=neo].node rect,[data-look=neo].node circle,[data-look=neo].node polygon,[data-look=neo].node path,[data-look=neo].node .outer-path,[data-look=neo].cluster rect{filter:none !important;}"}}%%
flowchart LR
  v12_actor_Operator(["Operator"]):::actor
  subgraph v12_Enterprise_PaymentGateway_GatewayMock ["GatewayMock#160;·#160;application"]
    direction TB
    v12_Enterprise_PaymentGateway_GatewayMock_server("server<br/>PaymentGateway · http-json"):::component
    v12_Enterprise_PaymentGateway_GatewayMock_operator("operator<br/>GatewayOperator · http-json"):::component
    v12_Enterprise_PaymentGateway_GatewayMock_charges("charges<br/>component"):::internal
    v12_Enterprise_PaymentGateway_GatewayMock_database("database<br/>component"):::internal
    v12_Enterprise_PaymentGateway_GatewayMock_logger("logger<br/>component"):::internal
    v12_Enterprise_PaymentGateway_GatewayMock_notifier("notifier<br/>component"):::internal
  end
  v12_Enterprise_PaymentSystem[["PaymentSystem<br/>solution"]]:::external
  v12_actor_Operator -->|"operator"| v12_Enterprise_PaymentGateway_GatewayMock
  v12_Enterprise_PaymentGateway_GatewayMock -.->|"notifier<br/>via"| v12_Enterprise_PaymentSystem
  v12_Enterprise_PaymentGateway_GatewayMock_server --> v12_Enterprise_PaymentGateway_GatewayMock_logger
  v12_Enterprise_PaymentGateway_GatewayMock_server -->|"api"| v12_Enterprise_PaymentGateway_GatewayMock_charges
  v12_Enterprise_PaymentGateway_GatewayMock_operator --> v12_Enterprise_PaymentGateway_GatewayMock_server
  v12_Enterprise_PaymentGateway_GatewayMock_operator -->|"api"| v12_Enterprise_PaymentGateway_GatewayMock_charges
  v12_Enterprise_PaymentGateway_GatewayMock_charges --> v12_Enterprise_PaymentGateway_GatewayMock_database
  v12_Enterprise_PaymentGateway_GatewayMock ==>|"charges<br/>handleWebhook<br/>http-webhook"| v12_Enterprise_PaymentSystem
  v12_Enterprise_PaymentGateway_GatewayMock_charges --> v12_Enterprise_PaymentGateway_GatewayMock_logger
  v12_Enterprise_PaymentGateway_GatewayMock_database --> v12_Enterprise_PaymentGateway_GatewayMock_logger
  v12_Enterprise_PaymentSystem ==>|"server<br/>PaymentGateway v1<br/>http-json"| v12_Enterprise_PaymentGateway_GatewayMock
  classDef unit fill:#dde8fb,stroke:#3567c4,color:#0d1b33
  classDef component fill:#dcf3e6,stroke:#2b8a57,color:#0c2a1a
  classDef internal fill:#eef0f3,stroke:#7c8697,color:#1d232c
  classDef missing fill:#fff3e2,stroke:#cc7a1f,color:#3a2200,stroke-dasharray:5 3
  classDef actor fill:#fbf0c3,stroke:#a9861a,color:#352900
  classDef external fill:#e4e7ec,stroke:#566070,color:#1d232c
  classDef requirement fill:#f2e5fb,stroke:#8045b8,color:#26103a
```
