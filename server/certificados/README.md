# Certificados públicos da ICP-Brasil usados pela conferência de assinaturas

Só certificados **públicos** de autoridades certificadoras. Nenhuma chave privada, senha ou `.pfx` entra nesta pasta.

## `icp-raizes.json` — âncoras de confiança

Raízes oficiais (Autoridade Certificadora Raiz Brasileira v4 a v13), com a URL do repositório do ITI em cada item.
São as **únicas** âncoras de confiança da conferência (`server/juridico-pki.ts`, `server/fiscal/`).

## `icp-intermediarias.json` — intermediárias oficiais embarcadas (23/11/2026)

**Por que existe.** As AC de 1º e 2º nível da ICP-Brasil não trazem a extensão AIA (de onde baixar o emissor): só
o certificado final aponta, por `http`, para o `.p7b` da certificadora. Ex.: o A1 da Prospecta (emitido pela
AC SAFEWEB RFB v5) aponta para `http://repositorio.acsafeweb.com.br/ac-safewebrfb/ac-safewebrfbv5.p7b`, mas a
AC SAFEWEB RFB v5 não diz onde está a AC Secretaria da Receita Federal do Brasil v4. Sem estes certificados a cadeia
parava no 2º salto e a conferência marcava "não pertence a uma cadeia ICP-Brasil reconhecida".

**Não são âncoras de confiança.** Cada intermediária só é usada se a assinatura dela conferir, salto a salto, até
uma raiz de `icp-raizes.json` (o PKIjs refaz a conferência completa a cada assinatura). Um item cujo SHA-256 não
bata com o registrado é descartado ao carregar (`intermediariasIcp` em `server/juridico-pki.ts`).

**O que entra** (`scripts/icp-intermediarias.mjs`): certificado de AC (`CA:TRUE`), conferido por assinatura até as
raízes RSA v5/v10/v11/v12/v13, vigente na data da geração, de assinatura de documentos (ficam fora SSL, code signing,
carimbo de tempo, SPB e OM-BR) e sem marcação de "retirado" no nome do arquivo do ITI.

**Fonte.** Pacote oficial do ITI `ACcompactado.zip`
(<http://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip>, hash publicado em
<http://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/hashsha512.txt>). Na sessão de 23/11 o
repositório do ITI e o da Safeweb estavam bloqueados pela rede do ambiente de desenvolvimento; os arquivos foram
lidos da cópia do `ACcompactado` distribuída no pacote npm `@nfewizard/shared@1.1.12` (`resources/certs/`). Isso não
muda a confiança: os certificados de AC são públicos, e cada um foi conferido criptograficamente até as raízes
oficiais acima (o que não confere, não entra). Conferência cruzada independente do SHA-256: AC SAFEWEB RFB v5
(`7b3a4be4…53ea`) e AC Secretaria da Receita Federal do Brasil v4 (`2c7a8ad7…5e21`) batem com os hashes publicados no
pacote de cadeia oficial do repositório `lucaszaous-creator/Clinica`; AC Secretaria da RFB v4 e AC Certisign RFB G5
(`e4c03634…e54d`) batem com as cadeias que vêm em certificados A1 publicados no GitHub.

**Como atualizar** (quando a ICP-Brasil credenciar AC nova ou uma vencer): baixar o `ACcompactado.zip` do link acima,
conferir o SHA-512 com o `hashsha512.txt`, extrair e rodar `node scripts/icp-intermediarias.mjs <pasta-extraída>`.
O teste `server/juridico-cadeia-icp-real.test.ts` confere de novo todas as entradas.

**Ausências conhecidas.** AC Secretaria da Receita Federal do Brasil **v3** não entra: é emitida pela Raiz v2 (fora de
`icp-raizes.json`) e venceu em 20/09/2021. "AC Certisign RFB G6" não consta
na cópia do ACcompactado usada (a linha RFB vigente da Certisign nela é a G5). A Soluti tem a "AC SOLUTI RFB V5" (linha RFB) e a
"AC SOLUTI Multipla v5" (linha própria, sob AC SOLUTI v5); a DIGITALSIGN, a "AC DIGITALSIGN RFB G2/G3".

### Lista (gerada em 23/11/2026: 128 intermediárias)

| Certificado | Emissor | Válido até | SHA-256 (DER) |
|---|---|---|---|
| AC Certisign G8 | Autoridade Certificadora Raiz Brasileira v12 | 2037-10-22 | `ee933126a9d74ff47614a41f571450e639748da2a6846260b4c20c17c3b0261d` |
| AC Safeweb v12 | Autoridade Certificadora Raiz Brasileira v12 | 2037-10-22 | `0a5615dc389acf39d1cb32a034dd430c4ebe65fe1873faac9ce8857f9d4f247d` |
| AC VALID V12 | Autoridade Certificadora Raiz Brasileira v12 | 2037-10-22 | `c0b14b86c5c9f3276bdce4bc8f6df4c448c22709d7ee70922ebebdd1f70895a3` |
| Autoridade Certificadora da Justica v6 | Autoridade Certificadora Raiz Brasileira v12 | 2037-10-22 | `080cdb1bfc8f0e64d0516466ee5f49ae83ddab923dc3001f7e508b42ea34ac08` |
| Autoridade Certificadora da Presidencia da Republica v6 | Autoridade Certificadora Raiz Brasileira v12 | 2037-10-22 | `e8433949434fac5388dc75b261578ca2b524c17a35e9ef82a0a47697631ada76` |
| AC Certisign Multipla G7 | AC Certisign G7 | 2029-03-01 | `044f059b2d162320ba41d1b048fad3a8f817fc41444d6ec4a8b5cdd3a57af37f` |
| AC EGBA Multipla G2 | AC Certisign G7 | 2029-03-01 | `26a242f8d1d4b56f47481d7501a6aafc151c262204895dc08da2daa89bc8933f` |
| AC Instituto Fenacon G3 | AC Certisign G7 | 2029-03-01 | `3743253d35ae0a0a84babca06ca0b4d3c2a7e42d2f8cf070fc6c2194e2c0ac97` |
| AC Instituto Fenacon G4 | AC Certisign G7 | 2029-03-01 | `56658d1e25f21fecb83d4c492a73463138bfc6de152698a434638b2e68a81151` |
| AC OAB G3 | AC Certisign G7 | 2029-03-01 | `336978ed70470d51cd65ca230a8680541671c6d7186a630255f068e7a9e71e11` |
| AC PRODEMGE G4 | AC Certisign G7 | 2029-03-01 | `686a130bbb944fe03935342dfa22ccabdd39fdcb6a872973fc7e20d28767ebd2` |
| AC SINCOR G4 | AC Certisign G7 | 2029-03-01 | `6117c39881680895531a25a5084be1861cf27d3aca43767dea8916685a036113` |
| AC DIGITAL MULTIPLA G1 | AC DIGITAL MAIS | 2029-03-01 | `a58e08559827da8607c444879530ac0cd1efd51e89ed18862fd4a1f1422a5eae` |
| AC DIGITALSIGN G2 | AC DIGITALSIGN ACP G2 | 2029-03-02 | `04265991d40b9fe940d4e080ceb555170c37d331dcf8093bfd5cee5e14d9edb9` |
| AC PRODESP v1 | AC PRODESP SP | 2029-03-02 | `641da20e042a0f0fdf83f7452739dc471432d3fa417f410eb2e78f1e3103e645` |
| AC CACB CD | AC SAFEWEB | 2029-03-02 | `52f57693ec3f47624ade9a8a316798c0756d14683d0ee1735501bc23ef0a451f` |
| AC CERTIPE CD | AC SAFEWEB | 2029-03-02 | `f5dba49351500b1b9b4bb8e8e613057d5e6f0bbf56b5ef24fae5a11e1964a405` |
| AC CERTMAIS CD | AC SAFEWEB | 2029-03-02 | `6dff7840fd529baa06c28d8999ab1d74d95cd7736a2e1dfc0e935a9b11e04b09` |
| AC LINK CD | AC SAFEWEB | 2029-03-02 | `2b06a3fdae08ab1663699d2e5b31796f37667110bce765df08df18d03675194e` |
| AC META CERTIFICADO DIGITAL CD | AC SAFEWEB | 2029-03-02 | `5ca230ca6071d5bea2436fd97a1b0d6aa40d70e04d87f9b807212d7c7fe0ec8e` |
| AC PLANO DIGITAL CD | AC SAFEWEB | 2029-03-02 | `5ad440982de71a5e7f585efe417bbf7c0b5ec745a69578896be2aad226853bd9` |
| AC PREMIUM CERTIFICADORA DIGITAL CD | AC SAFEWEB | 2029-03-02 | `2583ffef4e68a4f7da55b504bf1d8fb1b303e4294b2a48659eb614d3fab97170` |
| AC REDE IDEIA CD | AC SAFEWEB | 2029-03-02 | `811ef0a4d237fcc38f9ba4f37dca35f8ea8f1ef00bdb711d1b90acaa526ce5cf` |
| AC SAFETECH CD | AC SAFEWEB | 2029-03-02 | `68ee66d364050632821fde5a8265664fedb180baa65b0be0c1bc974cabbf6f94` |
| AC SAFEWEB CD | AC SAFEWEB | 2029-03-02 | `3133e61b8b1ca0607dc323dd62b2d72bae114c8dae147df4b4003542e9f01a44` |
| AC SEMPRE CD | AC SAFEWEB | 2029-03-02 | `408eb48982301b89608826633b3d530975fa6621e2dcc77e3d838ee0197dd3ea` |
| AC A DIGIFORTE RFB | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `32fc6dc9b74a29abac47756a2a3c23a9352714cd8c452570b8aa973d640cf04c` |
| AC BR RFB G4 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `f834cba03d07ba6c65cae4098b39ba601ec20accabc439b6793df0a0319c4f02` |
| AC CACB RFB G2 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `6ec2d9ca0b038e99f14648196d8368fa9edf68aef31062d779b29104af3abe89` |
| AC Certisign RFB G5 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `e4c03634bfb8140aecc38eb87125e1e94a91a5438c25eb3e63fe2a05f9c7e54d` |
| AC CNDL RFB v3 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `64e78f499939ead95af3cabed953edba0e33b2d7285e1831e2019ce23f3e3b20` |
| AC CONSULTI BRASIL RFB | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `0c022fc1371afab87f8a10b6f87d50f5981c5487cc374177880a21536a784178` |
| AC CONSULTI RFB | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `01335ad9a0f1701988f72e0ee93b001132959856a1423f872b753c68460dab50` |
| AC DIGITALSIGN RFB G2 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `7cfaf77a82f5207ded3b12e24625dd2c20aa163606c13ee93167b75d30ebd0a7` |
| AC DIGITALSIGN RFB G3 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `e5afdcc630ef0042d6fa93524d3a4678d59c08caefee0c55fe23e171849028fb` |
| AC DOCCLOUD RFB v2 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `422001f772cc9d6e6cc5fe0035f2779977d5d99c0ce15857e52db7c92d3dc36f` |
| AC EGBA RFB | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `fffd61fb8c91526508ba37101764ee9d7822ab67795bfcab2f410585195c6349` |
| AC FENACOR RFB | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `4cc8475949709251fb91ae9fc94863e35b122dcea3670d19257c9b2d9e0cb8bf` |
| AC Imprensa Oficial SP RFB G5 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `161b13851d3b5224d6f001c909539505830681384885e2f5c1af6a410500e492` |
| AC Instituto Fenacon RFB G3 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `c747659dbcefcdce3a1cb6b63ead065ceb1beaf7c0a20081d0a1bd885adac634` |
| AC LINK RFB v2 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `2118d007109598023f9cdc7dcacabf4e5f4a7ba7d8d8a00118f588989c8f30ba` |
| AC Notarial RFB G4 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `a9b2f6467ee2d778c6f64d2ce59a4166a5d264302173e22340ed0aa04fe1967e` |
| AC ONLINE RFB v5 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `778dd0ef727edb74ae90d0612fa91b109f42f9752faba2ca654a4dca12421e5d` |
| AC Prodemge RFB | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `424f89ecc158757d5bf225b120466411beac463112334cd133c80524fb218dba` |
| AC PRODEMGE RFB G4 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `30a997c193a13b3bfc51053cb255948be707b7fa1ede9568e32c8df1d9c47de9` |
| AC PRODESP RFB v1 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `48e7841baf1329afdf1a83d8822ec12fa4dee43da138cfadb3c56cb29c7d1b3f` |
| AC REDE IDEIA RFB | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `b5c8c963b2acd8464124acd189e13ed8f49483faddc0926eb469d0718326a5e4` |
| AC SAFEWEB RFB v5 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `7b3a4be434dccfb19009d4835104a052a8ab64850145a48c625784e821e053ea` |
| AC SEMPRE RFB v2 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `3f7be6ed5880be90a97502273f564456b0a6c95047e8eada87a1b2e9f2783da0` |
| AC SERASA RFB v5 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-02 | `c210da2fdd8004ddacdf0502d1bfb3baefbccb055909635a2f974aae5e1832da` |
| AC SIC RFB | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `80e5bdc5ea02d066098a6a94acbf29868431006e0bfc6f32d600cdbb0a44f972` |
| AC SINCOR RFB G5 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `066cacab9fccfb26e7fd8d1ad20a0f2d1a7c0c7f73b3b38dfbf17edbe57d2f6f` |
| AC SINCOR RIO RFB G2 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `99ad65f6e92b830f4ab878cf6d6dd49ca28b2be0dcd9e430020c4054dc689357` |
| AC SOLUTI RFB V5 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `f2b90985d0bb905d7bfbeaea84eedcda5b8a6817ed8b2cfcf528443c31fc5af9` |
| AC VALID RFB v5 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `a1646bcc36a7f56c7cf51cb046ee1aef46fc62a9f2c65902a51ca5c62da6e89d` |
| Autoridade Certificadora SERPRORFBv5 | AC Secretaria da Receita Federal do Brasil v4 | 2029-02-20 | `b1e93a025411fed62316e99953d61446f1bc3c205f7d8a746c4d8149c24959ab` |
| AC A R A CERTIFICACAO DIGITAL v5 | AC SOLUTI v5 | 2029-03-02 | `1df99eea3441412a790786fd6891f9303c0aceb7e4ad5c727836d3e5a9fb5a5f` |
| AC ACD v5 | AC SOLUTI v5 | 2029-03-02 | `65343be047cfdb1d84ca185cd0cc97a65bb1b539724c8f28d9aed3cb82dfdf8f` |
| AC CERTFACIL v5 | AC SOLUTI v5 | 2029-03-02 | `bd7e29bdecff589bd8fbf6ab2e7b67af57866cb82e4ab65f5016c73c9b7c2d78` |
| AC CERTIFICA ANAPOLIS v5 | AC SOLUTI v5 | 2029-03-02 | `ead7e3966e8162982e64f5756d9070cc6f80af9e20cfa54205175163daad76a5` |
| AC CERTIFICA MINAS v5 | AC SOLUTI v5 | 2029-03-02 | `f3da57309d1d966d9971c67f348d56984b49c68a15098199e21c2ad27128604a` |
| AC DIGITAL v5 | AC SOLUTI v5 | 2029-03-02 | `417254553472bb93316934f2bf85f6f94493d7256720229d9307b8c6f2e75c4b` |
| AC FCDL SC v5 | AC SOLUTI v5 | 2029-03-02 | `20755aa36ed586de60da09014101eb589bc1b1ce4ae7278782be97830f23672f` |
| AC INFOCO DIGITAL v5 | AC SOLUTI v5 | 2029-03-02 | `e5c7e6d559ad25adbc66daeca7e9d97bbdd5d8acbb021a455b27b4033f79fffb` |
| AC INTERCERT v5 | AC SOLUTI v5 | 2029-03-02 | `bd567bb5abd082f04d1fbafe0facc8f141345631f99e6cf537d4ff7fb2727d77` |
| AC MAXIMUS TECNOLOGIA E EVENTOS v5 | AC SOLUTI v5 | 2029-03-02 | `3c56109e34da5e473559e26f2dc9db4b396e79ca1507c3994d10034f629c59d5` |
| AC MULT v5 | AC SOLUTI v5 | 2029-03-02 | `6df1ab759ee5958cf10e7fd32255a9d0f5429a0040b93d8310dd49d55d71d4b4` |
| AC PRIME v5 | AC SOLUTI v5 | 2029-03-02 | `3fd6429b82030b1eaefacbe7c877e00a274439d921e7e3e017f59a85375b9892` |
| AC QUALITYCERT v5 | AC SOLUTI v5 | 2029-03-02 | `5acb552f0d2088d12aef1ce3fb4ee9b9fa98bac07ca0206246585841c997a090` |
| AC REDE BRASIL v5 | AC SOLUTI v5 | 2029-03-02 | `465f8a6d027423b1546cc686728a1d354860e4ce2a8d422a452f98df3c47f7ee` |
| AC SOLUTI Multipla v5 | AC SOLUTI v5 | 2029-03-02 | `c2a4dec225fb2c940ca5465aabd6742b9de9466c2530f069acd06d24852d7a4e` |
| AC CCN COMPANHIA CERTIFICADORA NACIONAL v5 | AC SOLUTI v5 G2 | 2029-03-02 | `2974393f5533dcdb56ad298236ce08bf6a8422857cb7d178a95cc4d197f59817` |
| AC CERTIFICA ANAPOLIS v5 G2 | AC SOLUTI v5 G2 | 2029-03-02 | `287f046480095871b20c714fc4bb2ae7e6ff05898c76dfe631e596811bfc9496` |
| AC DIGISEC v5 | AC SOLUTI v5 G2 | 2029-03-02 | `e4f8c8383ec5c82535da991f0a0145988401201e907116238ed23fc2b1cc37e4` |
| AC FCDL SC v5 G2 | AC SOLUTI v5 G2 | 2029-03-02 | `8e8f60fd420fc03859cd0d134e8cfdef5b871f71e11615af22592bf8dca25fd2` |
| AC MAXIMUS TECNOLOGIA E EVENTOS v5 G2 | AC SOLUTI v5 G2 | 2029-03-02 | `d7c450633dfe0aa9be40939c8fc83bcef9adb181b182be73c925e783bfb7919b` |
| AC REDE BRASIL v5 G2 | AC SOLUTI v5 G2 | 2029-03-02 | `ee93335f03d59890da917b364ea905a77ce1cbf36c8d43da48b7adb56e5ec64e` |
| AC SEGURA ID v5 | AC SOLUTI v5 G2 | 2029-03-02 | `ed64b83902b2286301143cd2c33a19d53ff58d4fca1375cebc29f6809cba4a6a` |
| AC SOLUTI Multipla v5 G2 | AC SOLUTI v5 G2 | 2029-03-02 | `bbdc7e24ce9a6f0ef7f63947d46831829531df73e71cb3df4b94deaecdf2962f` |
| AC Solucao Digital Multipla | AC SyngularID | 2029-02-27 | `34923090881c8e9c4d59daf7cac2eb36f42bac68690f90847b28e0da05660fbe` |
| AC SyngularID Multipla | AC SyngularID | 2029-03-01 | `80286f924af578f8a9792a41ab99ee8a5153a310440896b26a07a775a20ddb53` |
| AC SyngularID Multipla | AC SyngularID | 2029-03-01 | `a8926532136f0a2671ba0c15cedb7a768a136990fc14174bf15b15d028605056` |
| AC Validar Multipla | AC SyngularID | 2029-02-25 | `9fd456e4c617047b95f57dc7ff4482a0550c07308896f7b7ca46a9f4b099385f` |
| AC CERTBANK | AC VALID v5 | 2029-01-23 | `3639771e7ecd0b0b579a7084ad43202c48cfb0bdd63d33e368ee213cb61483df` |
| AC CERTDATA BRASIL | AC VALID v5 | 2028-02-23 | `928815242aa5ba0324f6e969a67cade023388decfd6c9a7a4018090db7e0a70d` |
| AC ONLINE BRASIL v5 | AC VALID v5 | 2029-03-01 | `37ba00eb866ed49726dc31798ed452ec58c14ea6e992d746b728a2e2ef9de275` |
| AC SENHA DIGITAL BRASIL | AC VALID v5 | 2028-11-10 | `7d59e874faad8548b7ab4658db01e85d8201c9db3169dcb2f98d39e8137d2db6` |
| AC SIC BRASIL | AC VALID v5 | 2029-03-01 | `cea3dcc425b766bfddf651d9bebe950b7ba129b143e66daa87885f18611d4249` |
| AC SIG BRASIL | AC VALID v5 | 2027-07-28 | `81f0890dc4c06155c8736a7e599ec1a070e2cefc161d46ed5a0af6fff6a320cd` |
| AC VALID BRASIL v5 | AC VALID v5 | 2029-03-01 | `925862b2baa67d33390fe4ff7ce6f58c425201ac0346fb9b86fe59d5c2c43af3` |
| AC VALID PLUS v5 | AC VALID v5 | 2029-03-01 | `138c195408aabd70daf6afd0fe75ff60c2793633f49ea01bc7fbb90b875f2297` |
| AC CERTISIGN-JUS G5 | Autoridade Certificadora da Justica v5 | 2029-02-20 | `c6e7eeb6f3e89b690205f1066c257fb714d885229ff89ec2798964ca8a167b80` |
| AC CERTISIGN-JUS G6 | Autoridade Certificadora da Justica v5 | 2029-02-20 | `27d1643ff97b4e80b23ffbd7cde72177f25327062b7acac3e9093c9f53005868` |
| AC SERASA-JUS v5 | Autoridade Certificadora da Justica v5 | 2029-02-20 | `46141cf3a91175430b44f336a837eee38a142b5315a74dce4d13184e9fae1255` |
| AC SERPRO-JUS v5 | Autoridade Certificadora da Justica v5 | 2029-02-20 | `a9c0a24d692735dfdd4c1c6d8e1caccab301933889a9888af283f9f0c651d0ad` |
| AC SOLUTI-JUS v5 | Autoridade Certificadora da Justica v5 | 2029-02-20 | `643a6952838d2ab34963ffd120923f01ce3f5dfe322e26096d812040819ab54f` |
| AC VALID-JUS v5 | Autoridade Certificadora da Justica v5 | 2029-02-20 | `9f4a9c50c168dba3e99b9909af817ca426f165ad5da3d66db42653bb339c7dd6` |
| AC Certisign G7 | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `94ebd763dcd39a858748d1433854f7d472b1dd47ddd27043236f83802faaf1ab` |
| AC DIGITAL MAIS | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `6d41e3193b432765cd6f0c40bedbbf16ed550ab3df18c51a8aa11d577ee2eef6` |
| AC DIGITALSIGN ACP G2 | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `cc7c467933f0ddb6f94e869d10d02cec3edcde55eea5bf970d969b067555f870` |
| AC DOCCLOUD | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `01b43f7f46bad994bb30c339d5b2ee4f8a0178b2bf4d476fa97c768404080a19` |
| AC PRODESP SP | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `6fa0127b16b56d93d9041da74084ec84fb6a1324eee5b8cdc4588b020f642482` |
| AC SAFEWEB | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `41aee78e09ed33ed838f7432493fd6bd3408eeb8f2c0b37dabf05b2310025f03` |
| AC Secretaria da Receita Federal do Brasil v4 | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `2c7a8ad75458f7e2fe8d7f7884a585127e4f242bd5c3ebea499dacb630315e21` |
| AC SOLUTI v5 | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `86d458365cfabffae4542ab98b99390f519ec9d831812b530045c412ae6eb5b6` |
| AC SOLUTI v5 G2 | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `642511549b34edb2f5062a9707a1c54548a4d1e0c3248b39c56cbca153708b64` |
| AC SyngularID | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `c7a8c891431df21d862b1ce626190451e96ab83138455c8dfaeee34a8b4b3db1` |
| AC VALID v5 | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `408e1f561f964e955f338b941895e520d1c75a182c9163fa84ba94bb5c3da6e6` |
| Autoridade Certificadora da Justica v5 | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `a517e77e9f362c6af120cf64f130d026d8064a595ede6c0caa3dc08559b85f56` |
| Autoridade Certificadora da Presidencia da Republica v5 | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `98c4101a3208b59712655b250b520bc2b5ecfb5c964f42a473d4c3821f92c5a9` |
| Autoridade Certificadora de Defesa | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `d55ea4e2a2f3a12868a46b6c527f5b12c982057cb65c055a3481045a32d45267` |
| Autoridade Certificadora SERPRO v4 | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `35330581e9224b72cb340fa44b8f57da79ac0a3c95160cbd4519ecc11bab5c12` |
| SERASA Autoridade Certificadora Principal v5 | Autoridade Certificadora Raiz Brasileira v5 | 2029-03-02 | `48e33502c111394103200a6fbb7d917bc02b9b2441545a230fb0b7fd3785df5e` |
| Autoridade Certificadora ALTERNATIVE | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `88219fcbc3939aa0a9b3f98e67eb32936eca0f0c0d0d91fbce8a048c3fb76e16` |
| Autoridade Certificadora BRASIL CERTEC | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `8340083c2e39e6dc1db7aec1729c3568d2126a1786f0c1c553a893af704b3f4f` |
| Autoridade Certificadora DIGITAL CERTY | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `dfc41f014f87246a9846f3b342eeaed21d20bf11baf2f87a81d7821a38cac8fa` |
| Autoridade Certificadora do SERPRO Final v5 | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `d4e68bdb73c0ff9160a8dbec971f640a7a0f71145100a6c6c94b187577ae575f` |
| Autoridade Certificadora IDFEDERAL | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `ade74944cb0d06d466d8f0d4a1bed8e5e962aa799876f63a50f5aeb88490483a` |
| Autoridade Certificadora INFOCOMEX | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `9699d2c03365c8a1cdc0c3b420b16755f2a7cfd581ca7767f751c9f3774d3bea` |
| Autoridade Certificadora INVIA | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `7143f26c9bc783df57f41e066d0a6b80511666cc8399e4ed76dc2d2a9522f2a8` |
| Autoridade Certificadora NACIONAL | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `34afd324c54c54a2e94fdacb22b52bf4430fe00411bf1871ed81a692ada4b773` |
| Autoridade Certificadora PRIMECERT | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `fe7ae1eef13e8ecf01f2838afd1925d1c8470a10594ae7f2d352a24f548ad7a6` |
| Autoridade Certificadora PROCERTI | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `e78ba5c40fdf78415e08e8ba759b5cacb0d0faeeb18e7b09f9b8df528a4c73e5` |
| Autoridade Certificadora SAFE-ID BRASIL | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `f7641df15120ad6895f93430d5d7a2272dcb500239d5e623fec4c2692215f34f` |
| Autoridade Certificadora SDI | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `8923c77ba2866bb17480fb2a035b683217abff27b7f455141535dbae54073301` |
| Autoridade Certificadora SEFAZCE | Autoridade Certificadora SERPRO v4 | 2029-02-15 | `2bc067a88eae745d722e4329d6e3fba6bed3d14dd07eec22f9a057a334b48f71` |
| SERASA Autoridade Certificadora v5 | SERASA Autoridade Certificadora Principal v5 | 2029-03-02 | `59c4882ea669ea2bbb7989787e2ed618cbeb0b48f74fbde532bbaa3565a20fc6` |
| SERASA Certificadora Digital v5 | SERASA Autoridade Certificadora Principal v5 | 2029-03-02 | `44d87346d313416611ed55d69d1756a9c7f74241e74af3d9dd440726e986d7c0` |
