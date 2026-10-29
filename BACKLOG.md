# Backlog

Itens solicitados e situação na versão 0.1.0.

| Item | Situação |
|---|---|
| Aplicação "QSL Analyzer" no padrão visual dos projetos PT2VHF | Feito: Electron, cabeçalho com marca/versão, idioma com bandeiras, tema claro/escuro |
| Análise de logs .adif e outros formatos conhecidos | Feito: ADIF, ADX, Cabrillo, EDI, CSV |
| Banco local com novos uploads incrementais (sem duplicar) | Feito |
| Configurações: limpar banco por indicativo | Feito: Configurações → Banco de dados |
| Análises completas de logs (Logs, Estatísticas, Exportar, Usuário) | Feito: veja o README |
| Menu superior com aba Logs (Containers, Upload, Import, Modify, Copy/Filter, Search) | Feito |
| Aba Estatísticas com as 20 análises | Feito |
| Aba Relatórios com relatório customizável e exportação em PDF | Feito |
| Importação de plataformas como o QRZ.com | Feito: QRZ.com, LoTW, eQSL, Club Log |
| Gráficos de BI "vivos" com interação do usuário | Feito: filtro por clique, período por arraste, legenda interativa, chips, desfazer, animações |
| Publicar no site com versões para Windows, Linux e macOS | Feito: www.pt2vhf.com/qsl, updates.json e update.php |

## Pendentes

(nenhum)

## Resolvidos na 0.4.0 (29/10/2026)

- **[Resolvido] Backlog (29/10/2026): backup e restauração de tudo em Configurações → Banco de dados.** Um único arquivo de
  backup com **todo** o estado do app: contatos, preferências, painéis salvos, modelos de relatório, bloco de
  notas, registro de atividade, cache das fichas (dados e fotos do QRZ/HamQTH), CTY.DAT carregado e
  configurações das plataformas. Hoje existe só "Backup do banco" (JSON) no menu Logs; levar para
  Configurações → Banco de dados (mantendo atalho em Logs) e completar:
  - **credenciais:** hoje ficam criptografadas pelo Windows e não abrem em outro computador; no backup,
    perguntar se inclui as senhas/chaves e, se sim, protegê-las com uma senha do backup (sem ela, restaura
    tudo menos as credenciais);
  - **restaurar:** mostrar o conteúdo do backup (data, versão, nº de contatos e estações) antes de aplicar,
    pedir confirmação, criar automaticamente um backup do estado atual antes de substituir e aceitar
    backups de versões anteriores (inclusive o JSON antigo);
  - **integridade:** arquivo com versão e soma de verificação; recusar arquivo corrompido sem mexer no banco;
  - **backup automático** opcional (ex.: diário ou a cada abertura), mantendo os N mais recentes na pasta de
    dados, com opção de escolher a pasta (ex.: nuvem).
- **[Resolvido] Backlog (29/10/2026): inserir, alterar e apagar um contato.** Formulário de QSO com os campos principais
  (indicativo, data/hora UTC, banda/frequência, modo/submodo, RST enviado/recebido, estação, operador,
  quadrículas, nome, QTH, comentário, concurso/troca, status de QSL papel/LoTW/eQSL) e acesso aos demais campos
  ADIF. Ações: **novo contato** (menu Logs e atalho na ficha do indicativo), **editar** e **apagar** a partir da
  ficha, da busca e das tabelas de QSOs (com confirmação). Validar dados (data, banda × frequência, modo),
  completar país/DXCC/zonas pelo CTY.DAT, avisar se o contato já existe (mesma regra da importação) e
  registrar a alteração no registro de atividade.
- **[Resolvido] Backlog (29/10/2026): menu Logs com importar, exportar e sincronizar por fonte.** Para cada plataforma
  (QRZ.com, LoTW, eQSL, Club Log), além de baixar/importar, permitir **enviar** os contatos do app e
  **sincronizar nos dois sentidos**:
  - QRZ.com: envio pela Logbook API (`ACTION=INSERT`, ADIF), com retorno de inseridos/duplicados/erros;
  - LoTW: o envio exige assinatura digital pelo **TQSL** (certificado e localização da estação): gerar o
    ADIF e chamar o TQSL instalado em linha de comando, ou orientar o envio pelo TQSL quando não estiver
    instalado;
  - eQSL: envio do ADIF pela importação do eQSL.cc (usuário/senha, apelido de QTH);
  - Club Log: envio pela API (`putlogs`/tempo real) com a chave de API;
  - sincronizar = baixar o que falta no app + enviar o que falta na plataforma (a partir da conferência
    que já existe), marcando no app `*_QSL_SENT`/data de envio para não reenviar; escolher o que enviar
    (tudo, só os que faltam, filtro atual) e mostrar o progresso e o resultado por plataforma;
  - também exportar por fonte: ADIF já no formato esperado por cada plataforma.
- **[Resolvido] Backlog (29/10/2026): renomear o programa para "PT2VHF QSL Manager".** Trocar o nome em toda a interface
  (cabeçalho, título da janela, Sobre, ajuda, aviso do site, relatórios/PDF), nos atalhos e no instalador
  (`productName`), no README/CHANGELOG e na página do site (título, menu de projetos, catálogo, textos em
  7 idiomas, sitemap). Cuidados para não quebrar quem já usa:
  - **dados:** manter o `appId`/pasta de dados atuais, ou migrar automaticamente a pasta antiga
    (`PT2VHF QSL Analyzer`) para a nova na primeira abertura, sem perder banco, preferências e credenciais;
  - **OTA:** a 0.3.0 instalada só aceita pacotes chamados `PT2VHF-QSL-Analyzer-*.exe`; manter esse nome de
    arquivo pelo menos na primeira versão renomeada (ou publicar uma versão de transição que aceite os dois
    nomes) para a atualização automática continuar funcionando;
  - **site e contadores:** manter o produto `qsl` no `updates.json`/`update.php`/`download.php` e a URL `/qsl`
    (ou redirecionar a nova URL para ela), preservando o histórico dos contadores de download;
  - instalação nova substitui a antiga (sem dois atalhos/programas instalados lado a lado);
  - registrar a troca de nome no CHANGELOG da versão.
- **[Resolvido] Backlog (29/10/2026): LoTW falha com "INVALID_RESPONSE" também com "Desde" vazio.** Depois de algumas
  tentativas, a mesma conta (que antes trouxe 7 QSOs sem data) passou a falhar sempre, com ou sem data, com
  "Sincronizar ao abrir o app" ligado. Hipótese principal: limite de requisições do LoTW (página "Page Request
  Limit" / bloqueio temporário por consultas repetidas ao `lotwreport.adi`), agravado pela sincronização a
  cada abertura. Corrigir junto com o item abaixo:
  - reconhecer a página de limite/bloqueio do LoTW e mostrar mensagem clara ("o LoTW limitou as consultas;
    tente novamente mais tarde"), sem novas tentativas imediatas;
  - sincronização automática do LoTW no máximo uma vez a cada 24 h, e nunca repetir após erro de limite;
  - sincronização incremental: depois do primeiro download completo, pedir só o que chegou desde a última
    sincronização bem-sucedida (guardar a data/hora do último sucesso por plataforma);
  - botão "Conferir com o app" e "Baixar e importar" desabilitados durante a consulta (evitar cliques
    repetidos), com intervalo mínimo entre consultas manuais ao LoTW.
- **[Resolvido] Backlog (29/10/2026): LoTW com data em "Desde" falha com "INVALID_RESPONSE".** Com usuário/senha salvos e
  Desde = 01/01/2017, o download do LoTW termina em "Falha: INVALID_RESPONSE" (sem data, a mesma conta
  funciona, mas só traz o que chegou desde o último download). O app trata como inválida qualquer resposta sem
  `<eoh>`; o LoTW devolveu outra coisa (provável página de erro/ocupado, tempo de geração do relatório ou
  rejeição do parâmetro de data). Corrigir:
  - mostrar o motivo real: status HTTP e o texto da resposta do LoTW (sem a senha) no erro e no registro
    de atividade, em vez de só "INVALID_RESPONSE";
  - conferir o formato de data aceito por `qso_qsorxsince` (AAAA-MM-DD) e, se necessário, usar
    `qso_startdate`; validar a data antes de enviar;
  - tratar LoTW ocupado/lento (respostas grandes): tempo limite maior e nova tentativa com espera;
  - se o relatório for grande demais, baixar em faixas de datas (por ano) e juntar;
  - testes com respostas simuladas de erro, ocupado e relatório grande.
- **[Resolvido] Backlog (29/10/2026): data inicial padrão 01/01/1980 nos downloads das plataformas.** Em LoTW, QRZ.com,
  eQSL e Club Log, o campo de data inicial ("Desde") vem preenchido com 01/01/1980 (editável), e é essa data
  que vai na consulta quando o usuário não mudar: LoTW `qso_qsorxsince=1980-01-01` (substitui o 1900-01-01
  da correção acima), eQSL `RcvdSince=19800101`, QRZ.com e Club Log com o parâmetro de data equivalente
  quando a API oferecer (senão, histórico completo e filtro local pela data). Mostrar o campo em todos os
  cartões de plataforma e explicar na ajuda.
- **[Resolvido] Correção (29/10/2026) — já no código, entra na próxima versão: LoTW importava só os QSOs recentes.**
  Sem data, o LoTW devolve apenas o que chegou desde o último download (o mantenedor recebeu 7 de milhares).
  Agora o pedido sempre envia `qso_qsorxsince` (vazio = 1900-01-01, histórico completo). Além disso, um
  `lotwreport.adi` baixado do site e importado como arquivo é reconhecido (PROGRAMID LoTW): `QSL_RCVD`
  vira confirmação LoTW, e não QSL em papel; o Inbox do eQSL vira confirmação eQSL. Testes incluídos.
- **[Resolvido] Backlog (29/10/2026): todo download e toda atualização OTA contabilizados.** Garantir, de ponta a ponta,
  que cada download conte exatamente uma vez no contador do site (`download.php`, produto `qsl`):
  - download manual pela página `/qsl` (instalador e portátil, e futuras plataformas Linux/macOS);
  - link direto `https://www.pt2vhf.com/downloads/qsl-analyzer/<arquivo>` (rewrite do `.htaccess` para o
    `download.php`), inclusive o usado pelo OTA do app;
  - atualização OTA do app (User-Agent `PT2VHF-QSL-Analyzer/x.y.z`), registrada também em `ota` no
    `mode=stats`; HEAD, retomadas (Range) e falhas de conferência não podem somar de novo;
  - versões antigas que só abrem a página (0.1.0 e 0.2.0) contam pelo download manual.
  - Conferir: o OTA não segue redirecionamento (o rewrite precisa responder 200 direto); cada `files[]` do
    `updates.json` tem `counterKey`; ampliar `scripts/test_qsl_download.php` (site) e os testes do app
    para simular o download do atualizador e verificar +1 exatamente uma vez, e conferir em produção
    (`download.php?mode=stats`) após a próxima publicação.

## Resolvidos na 0.3.0 (29/10/2026)

- **[Resolvido] Backlog (29/10/2026): revisão de textos e créditos.** Textos do app, README, CHANGELOG e página do
  site revisados.
- **[Resolvido] Backlog (29/10/2026): atualização OTA automática, como nos demais apps PT2VHF.** Hoje o aviso de versão
  nova só abre a página do projeto. Deve seguir o fluxo do Prop Tool/Sat Tool:
  - consultar `https://www.pt2vhf.com/update.php?product=qsl&platform=<plataforma>&kind=<installer|portable>`
    conforme o pacote em uso (instalado ou portátil) e mostrar a versão e as notas;
  - "Atualizar agora" baixa o pacote certo pela URL do site (passa pelo `download.php`, contando uma vez
    como OTA pelo User-Agent `PT2VHF-QSL-Analyzer/x.y.z`), com progresso (percentual, bytes e velocidade);
  - conferir tamanho e SHA-256 do `updates.json` antes de instalar; se não conferir, descartar e avisar;
  - instalado: executar o instalador NSIS em modo silencioso, fechar o app e reabrir na versão nova;
    portátil: substituir o .exe com segurança (cópia de recuperação da versão anterior) e reabrir;
  - preservar banco, preferências e credenciais; na primeira abertura após atualizar, mostrar as novidades
    uma única vez; "Depois" adia o aviso até a próxima verificação.
- **[Resolvido] Backlog (29/10/2026): página do QSL Analyzer no site com screenshots e changelog no fim.** A galeria de
  screenshots e o histórico de versões (changelog completo, versão a versão) aparecem no fim da página `/qsl`.

## Resolvidos na 0.2.0 (29/10/2026)

- **[Resolvido] Roadmap (29/10/2026): indicativo clicável em toda a aplicação.** Sempre que um indicativo aparecer
  (por exemplo, a lista de Estações trabalhadas, Busca no log, duplicados, pontos, DXCC first worked,
  QSOs mais distantes, dashboard), ele deve ser clicável e abrir tudo sobre aquela estação nos meus
  contatos: todos os QSOs (data/hora, banda, modo, RST, frequência, container, estação/operador),
  bandas e modos trabalhados, slots, primeiro e último contato, país/DXCC, zonas, quadrícula, distância
  e azimute, e status de QSL (papel, LoTW, eQSL) de cada QSO.
- **[Resolvido] Backlog (29/10/2026): omitir containers e organizar só por estação.** Os containers não devem
  aparecer para o usuário: todos os ADIFs enviados, de qualquer estação, ficam num único container
  interno, e a organização visível é apenas por estação (indicativo/STATION_CALLSIGN). Ajustar: menu Logs
  (sem "Gerenciar containers" e sem escolha de container na importação, em Copiar/filtrar, Modificar e
  plataformas), barra de filtros (sem o filtro Container), dashboard, banco de dados (limpeza só por
  indicativo, sem "Restringir ao container"), Comparar (só estações), busca e textos de ajuda/README.
  A importação incremental continua sem duplicar QSOs (mesma estação, indicativo, banda, modo e minuto).
  Bancos já existentes com mais de um container devem ser unidos no container único, sem duplicar QSOs.
- **[Resolvido] Backlog (29/10/2026): importar e exportar juntos.** A aba Exportar saiu do menu superior (29/10/2026):
  "Exportar logs" e "Backup do banco" agora ficam no menu Logs. Importação e exportação ficam juntas no
  menu Logs, onde o usuário tanto importa logs para o app (arquivos ADIF e demais
  formatos, e plataformas online) quanto exporta. Na importação, os contatos que já existirem no banco são
  ignorados. Durante a importação abre um popup com a barra de progresso e as contagens, atualizadas em
  tempo real, de contatos importados e de contatos ignorados por já existirem (e o total processado), com
  o resumo final ao terminar.
- **[Resolvido] Backlog (29/10/2026): aviso do site oficial igual ao do Mesh Analyzer.** Trocar o diálogo exibido a
  cada abertura pelo mesmo modelo do PT2VHF Mesh Analyzer: título "Downloads no site oficial"; texto
  "A partir de agora, as novas versões e os instaladores do PT2VHF QSL Analyzer serão distribuídos pelo
  site oficial."; link sublinhado "www.PT2VHF.com" (abre o site); um único botão "Entendi" alinhado à
  direita (com foco). Mesmo visual: cartão escuro com cantos arredondados e borda clara, título em
  negrito, sem os botões "Abrir o site"/"Continuar" atuais. Traduzir para inglês e espanhol. O aviso de
  versão nova continua aparecendo logo depois de fechar este.
- **[Resolvido] Backlog (29/10/2026): melhorias de análise dos contatos.** Aprovadas pelo mantenedor; prioridade
  sugerida nesta ordem: progresso de diplomas com "faltam confirmar", resumo em linguagem natural e
  saúde do log.
  1. **Progresso de diplomas:** DXCC (Mixed, Phone, CW, Digital e por banda), WAS, WAZ, WPX, VUCC
     (quadrículas VHF/UHF) e IOTA, com trabalhado, confirmado e o que falta (lista do que falta).
  2. **"Faltam confirmar":** entidades trabalhadas e não confirmadas, com o melhor QSO de cada uma para
     pedir QSL.
  3. **Entidades raras:** destacar as entidades mais procuradas (Most Wanted do Club Log) já trabalhadas.
  4. **"Sua atividade" em linguagem natural no Dashboard:** resumo automático (totais do período, modo
     predominante, melhor mês, contato mais distante, quantas entidades faltam para o DXCC).
  5. **Comparativo de períodos:** este ano × ano passado, este mês × média; o que cresceu, caiu e o que é
     novo.
  6. **Melhor horário por banda e região:** hora UTC × continente para cada banda, a partir dos próprios
     QSOs.
  7. **Alcance por banda ao longo do tempo:** distância e direção dos contatos por banda, mês a mês
     (efeito do ciclo solar).
  8. **Ficha do indicativo ampliada** (complementa o item do indicativo clicável): histórico com a
     estação, datas e quantidade de contatos.
  9. **Amigos frequentes e "sumidos":** estações mais contatadas e as que não aparecem há muito tempo.
  10. **Novos indicativos por período:** indicativos inéditos por mês.
  11. **Saúde do log:** QSOs sem quadrícula, banda incompatível com a frequência, modo inválido,
      possíveis duplicados com poucos minutos de diferença e indicativos possivelmente mal digitados
      (ex.: PT2VHF × PT2VFH), com correção em lote.
  12. **Conferência entre plataformas:** cruzar o log local com LoTW, QRZ e eQSL e listar o que está só
      de um lado, para reenviar.
  13. **Análise de concurso:** detectar o período pelo CONTEST_ID, pontuação estimada, multiplicadores,
      taxa por hora e comparação com o mesmo concurso do ano anterior.
  14. **Sincronização automática:** buscar novidades do QRZ/LoTW ao abrir o app, em segundo plano.
  15. **Painéis salvos:** guardar combinações de filtros com nome (ex.: "2 m FM em 2024").
  16. **Relatório anual pronto:** modelo de PDF "Meu ano no rádio" para compartilhar.
- **[Resolvido] Backlog (29/10/2026): unir "Enviar logs" e "Importar logs" num único "Importar logs".** Acabar com a
  fila intermediária: o usuário
  escolhe, arrasta ou cola os arquivos e a importação começa na hora, com o popup de progresso (importados,
  ignorados por já existirem, total) e o resumo final. Sem escolha de container (ver item de omitir
  containers); indicativo da estação padrão só quando o log não trouxer STATION_CALLSIGN. Renumerar o
  submenu Logs e atualizar ajuda e README.
- **[Resolvido] Backlog (29/10/2026): entidades clicáveis com ficha completa.** Assim como o indicativo, toda
  entidade exibida deve ser clicável e abrir tudo sobre ela nos meus contatos: países/entidades DXCC
  (ex.: matriz DXCC da aba QSL, DXCC first worked, DXCC/locator, mapas), quadrículas (grids), prefixos,
  zonas CQ/ITU, continentes e estações. A ficha mostra os QSOs, estações trabalhadas, bandas e modos,
  primeiro e último contato, status de QSL por banda (trabalhado/confirmado), quadrículas e mapa.
- **[Resolvido] Correção visual (29/10/2026):** na matriz DXCC da aba QSL, os títulos das colunas não ficam alinhados
  com os valores (DXCC e Continente deslocados); alinhar cabeçalho e células.
- **[Resolvido] Backlog (29/10/2026): análise de propagação a partir dos contatos.** Nova página (Estatísticas →
  Propagação) que usa os QSOs importados como evidência de abertura de propagação ao longo do tempo:
  - matriz mês × país/entidade (e mês × continente) por banda, mostrando quando cada região "abriu";
  - hora UTC × mês por banda e região (sazonalidade e janelas de abertura: greyline, abertura diurna/noturna);
  - distâncias e azimutes por banda ao longo dos meses (alcance médio/máximo e direções predominantes);
  - aberturas esporádicas em VHF/UHF (ex.: Es em 6 m e 2 m, tropo): QSOs longos fora do padrão da banda,
    agrupados por data, com mapa;
  - comparação entre anos (efeito do ciclo solar) e, opcionalmente, cruzamento com índices solares
    históricos (SFI/SSN, Kp) quando disponíveis;
  - tudo interativo (clique filtra, ficha da entidade) e exportável/relatório. Deixar claro que o resultado
    reflete a atividade do próprio operador (não mede propagação absoluta).
- **[Resolvido] Backlog (29/10/2026): ficha da estação com dados do QRZ.com (complementa o indicativo clicável).**
  Ao clicar num indicativo, a ficha mostra em cima os dados da estação e embaixo tudo o que fiz de contato
  com ela (QSOs, bandas, modos, primeiro/último contato, QSL por QSO, distância/azimute e mapa).
  - Fonte principal: API XML do QRZ.com (XML Logbook Data, `xmldata.qrz.com`), nunca leitura da página
    `qrz.com/db/<indicativo>` (proibida pelos termos do QRZ). Campos: foto, nome, QTH/endereço, país,
    quadrícula, coordenadas, zonas CQ/ITU, IOTA, classe de licença, uso de LoTW/eQSL e link "Ver no QRZ.com".
  - Assinatura XML Data do QRZ traz todos os campos (inclusive foto); conta gratuita traz só o básico (nome,
    cidade, país). Indicar na ficha quando o dado é limitado pelo tipo de conta.
  - Alternativa gratuita: HamQTH.com (API com cadastro): usar quando a conta QRZ não tiver assinatura ou a
    estação não estiver no QRZ. O que nenhuma fonte devolver vira link para abrir a página no navegador.
  - Credenciais do QRZ/HamQTH em Configurações, guardadas criptografadas (como as das plataformas).
  - Cache local no banco (dados e foto), com data da consulta e botão "Atualizar dados do QRZ", para não
    consultar a cada clique e funcionar offline.
- **[Resolvido] Ajuste de CI:** release existente nunca é sobrescrita; plataformas escolhidas em `.github/build-platforms.json`. o job de release usa `gh release upload --clobber`; um push
  na `main` sem mudar a versão sobrescreveria os pacotes da release já publicada no site (SHA-256 diferente).
  Pular o upload quando a release da versão já existir.

- **[Resolvido] Backlog (29/10/2026): páginas em sub-abas e filtros recolhidos.** Páginas longas são
  divididas automaticamente em sub-abas (por gráfico/seção) e a barra de filtros fica recolhida, mostrando
  só os chips dos filtros ativos, e expande quando necessário.
- **[Resolvido] Backlog (29/10/2026): screenshots na página do QSL Analyzer no site.**

## Próximos passos sugeridos

- HRDLog e Cloudlog/Wavelog via API (hoje: exportar ADIF e enviar).
- Atualização automática do CTY.DAT pela internet.
- Voltar a publicar Linux e macOS (adicionar em `.github/build-platforms.json`).
- Manual em PDF ilustrado, como nos outros aplicativos PT2VHF.
- Assinatura de código (Windows) e notarização Apple (macOS).
