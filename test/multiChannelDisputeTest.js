'use strict'

// Bi-direction Ether Payment Channel Tests

import MerkleTree from './helpers/MerkleTree'

const MultiSig = artifacts.require("./MultiSig.sol")
const Registry = artifacts.require("./CTFRegistry.sol")
const MetaChannel = artifacts.require("./MetaChannel.sol")

// Interpreters / Extension
const PaymentChannel = artifacts.require("./LibBidirectionalEther.sol")
const EtherExtension = artifacts.require("./EtherExtension.sol")

const Utils = require('./helpers/utils')

// State
let reg
let msig
let ethExtInst
let ethExtAddress

let partyA
let partyB

let subchannelRootHash

// channel code
let metachannel
let metaChannelBytecode
let metachannelCTFaddress
// library addresses
let paymentchannel
let paymentchanneladdress

// sig storage
let metachannelCTFsigA
let metachannelCTFsigB
let s0sigA
let s0sigB
let s1sigA
let s1sigB
let s2sigA
let s2sigB
let s3sigA
let s3sigB
let s4sigA
let s4sigB

// state storage
let metaCTF
let s0
let s0marshall
let s1
let s1marshall
let s2
let s2marshall
let s3
let s3marshall
let s4
let s4marshall

// payment sub channel state storage
let roothash
let ethChannelID
let ethChannelIDv2
let ss0
let ss0v2
let ss0marshall
let ss0marshallv2
let ss1 
let ss1marshall
let ss1v2 
let ss1marshallv2

contract('Test Multiple Disputed Channels', function(accounts) {

  before(async () => {
    partyA = accounts[1]
    partyB = accounts[2]

    reg = await Registry.new()
    paymentchannel = await PaymentChannel.new()
    paymentchanneladdress = paymentchannel.address
  })

  it("counterfactually instantiate meta-channel", async () => {
    // TODO: Use web3 to get predeployed bytecode with appended constructor args
    var args = [reg.address, partyA, partyB]
    var signers = [partyA, partyB]

    metachannel = await MetaChannel.new(reg.address, partyA, partyB)
    metaCTF = await Utils.getCTFstate(metachannel.constructor.bytecode, signers, args)
    metachannelCTFaddress = await Utils.getCTFaddress(metaCTF)
  })

  it("both parties sign metachannel ctf code, store sigs", async () => {
    metachannelCTFsigA = await web3.eth.sign(partyA, metachannelCTFaddress)
    metachannelCTFsigB = await web3.eth.sign(partyB, metachannelCTFaddress)
  })

  it("deploy MultiSig", async () => {
    msig = await MultiSig.new(metachannelCTFaddress, reg.address)
  })

  it("deploy ether Extension", async () => {
    ethExtInst = await EtherExtension.new()
    ethExtAddress = ethExtInst.address
  })

  it("generate initial ether state", async () => {
    var inputs = []
    inputs.push(0) // is close
    inputs.push(0) // sequence
    inputs.push(partyA) // partyA address
    inputs.push(partyB) // partyB address
    inputs.push(metachannelCTFaddress) // counterfactual metachannel address
    inputs.push('0x0') // sub-channel root hash
    inputs.push(web3.toWei(10, 'ether')) // balance in ether partyA
    inputs.push(web3.toWei(20, 'ether')) // balance in ether partyB

    s0 = inputs
    s0marshall = Utils.marshallState(inputs)
  })

  it("partyA signs state and opens msig agreement", async () => {
    s0sigA = await web3.eth.sign(partyA, web3.sha3(s0marshall, {encoding: 'hex'}))
    var r = s0sigA.substr(0,66)
    var s = "0x" + s0sigA.substr(66,64)
    var v = parseInt(s0sigA.substr(130, 2)) + 27

    var receipt = await msig.openAgreement(s0marshall, ethExtAddress, v, r, s, {from: accounts[1], value: web3.toWei(10, 'ether')})
    var gasUsed = receipt.receipt.gasUsed
    //console.log('Gas Used: ' + gasUsed)
    
  })

  it("partyB signs state and joins msig agreement", async () => {
    s0sigB = await web3.eth.sign(partyB, web3.sha3(s0marshall, {encoding: 'hex'}))
    var r = s0sigB.substr(0,66)
    var s = "0x" + s0sigB.substr(66,64)
    var v = parseInt(s0sigB.substr(130, 2)) + 27

    var receipt = await msig.joinAgreement(s0marshall, ethExtAddress, v, r, s, {from: accounts[2], value: web3.toWei(20, 'ether')})
    var gasUsed = receipt.receipt.gasUsed
    //console.log('Gas Used: ' + gasUsed)
  })

  it("generate ether payment channel state", async () => {
    // Since channels are now library logic, we can resuse deploys between channels
    // We probably don't need to counterfactually instantiate a lib for every channel
    ethChannelID = web3.sha3('salt1')

    var subchannelInputs = []
    subchannelInputs.push(0) // is close
    subchannelInputs.push(0) // is force push channel
    subchannelInputs.push(0) // subchannel sequence
    subchannelInputs.push(0) // timeout length ms
    subchannelInputs.push(paymentchanneladdress) // ether payment interpreter library address
    subchannelInputs.push(ethChannelID) // ID of subchannel
    subchannelInputs.push(metachannelCTFaddress) // counterfactual metachannel address
    subchannelInputs.push(reg.address) // CTF registry address
    subchannelInputs.push('0x0') // subchannel tx roothash
    subchannelInputs.push(partyA) // partyA in the subchannel
    subchannelInputs.push(partyB) // partyB in the subchannel
    subchannelInputs.push(web3.toWei(0, 'ether')) // balance of party A in subchannel (ether)
    subchannelInputs.push(web3.toWei(10, 'ether')) // balance of party B in subchannel (ether)

    ss0 = subchannelInputs
    ss0marshall = Utils.marshallState(subchannelInputs)
    
    var hash = web3.sha3(s0marshall, {encoding: 'hex'})
    var buf = Utils.hexToBuffer(hash)
    var elems = []
    elems.push(buf)
    var merkle = new MerkleTree(elems)

    subchannelRootHash = Utils.bufferToHex(merkle.getRoot())

    //console.log(merkle.root())

    var inputs = []
    inputs.push(0) // is close
    inputs.push(1) // sequence
    inputs.push(partyA) // partyA address
    inputs.push(partyB) // partyB address
    inputs.push(metachannelCTFaddress) // counterfactual metachannel address
    inputs.push(subchannelRootHash) // sub-channel root hash
    inputs.push(web3.toWei(10, 'ether')) // balance in ether partyA
    inputs.push(web3.toWei(10, 'ether')) // balance in ether partyB

    s1 = inputs
    s1marshall = Utils.marshallState(inputs)
  })

  it("both parties sign state: s1", async () => {
    s1sigA = await web3.eth.sign(partyA, web3.sha3(s1marshall, {encoding: 'hex'}))
    s1sigB = await web3.eth.sign(partyB, web3.sha3(s1marshall, {encoding: 'hex'}))
  })

  it("generate ether channel payment", async () => {
    var subchannelInputs = []
    subchannelInputs.push(0) // is close
    subchannelInputs.push(1) // subchannel sequence
    subchannelInputs.push(0) // is force push channel
    subchannelInputs.push(0) // timeout length ms
    subchannelInputs.push(paymentchanneladdress) // ether payment interpreter library address
    subchannelInputs.push(ethChannelID) // ID of subchannel
    subchannelInputs.push(metachannelCTFaddress) // counterfactual metachannel address
    subchannelInputs.push(reg.address) // CTF registry address
    subchannelInputs.push('0x0') // subchannel tx roothash
    subchannelInputs.push(partyA) // partyA in the subchannel
    subchannelInputs.push(partyB) // partyB in the subchannel
    subchannelInputs.push(web3.toWei(1, 'ether')) // balance of party A in subchannel (ether)
    subchannelInputs.push(web3.toWei(9, 'ether')) // balance of party B in subchannel (ether)

    ss1 = subchannelInputs
    ss1marshall = Utils.marshallState(subchannelInputs)
    
    var hash = web3.sha3(ss1marshall, {encoding: 'hex'})
    var buf = Utils.hexToBuffer(hash)
    // TODO: deal with all subchannels stored as elems array, and how to replace
    // each channel independently when they are updated
    var elems = []
    elems.push(buf)
    var merkle = new MerkleTree(elems)

    subchannelRootHash = Utils.bufferToHex(merkle.getRoot())

    //console.log(merkle.root())

    var inputs = []
    inputs.push(0) // is close
    inputs.push(2) // sequence
    inputs.push(partyA) // partyA address
    inputs.push(partyB) // partyB address
    inputs.push(metachannelCTFaddress) // counterfactual metachannel address
    inputs.push(subchannelRootHash) // sub-channel root hash
    inputs.push(web3.toWei(10, 'ether')) // balance in ether partyA
    inputs.push(web3.toWei(10, 'ether')) // balance in ether partyB

    s2 = inputs
    s2marshall = Utils.marshallState(inputs)    
  })

  it("both parties sign state: s2", async () => {
    s2sigA = await web3.eth.sign(partyA, web3.sha3(s2marshall, {encoding: 'hex'}))
    s2sigB = await web3.eth.sign(partyB, web3.sha3(s2marshall, {encoding: 'hex'}))
  })

  it("generate 2nd ether payment channel state", async () => {
    // Since channels are now library logic, we can resuse deploys between channels
    // We probably don't need to counterfactually instantiate a lib for every channel
    ethChannelIDv2 = web3.sha3('salt2')

    var subchannelInputs = []
    subchannelInputs.push(0) // is close
    subchannelInputs.push(0) // is force push channel
    subchannelInputs.push(0) // subchannel sequence
    subchannelInputs.push(0) // timeout length ms
    subchannelInputs.push(paymentchanneladdress) // ether payment interpreter library address
    subchannelInputs.push(ethChannelIDv2) // ID of subchannel
    subchannelInputs.push(metachannelCTFaddress) // counterfactual metachannel address
    subchannelInputs.push(reg.address) // CTF registry address
    subchannelInputs.push('0x0') // subchannel tx roothash
    subchannelInputs.push(partyA) // partyA in the subchannel
    subchannelInputs.push(partyB) // partyB in the subchannel
    subchannelInputs.push(web3.toWei(5, 'ether')) // balance of party A in subchannel (ether)
    subchannelInputs.push(web3.toWei(0, 'ether')) // balance of party B in subchannel (ether)

    ss0v2 = subchannelInputs
    ss0marshallv2 = Utils.marshallState(subchannelInputs)
    
    var hash = web3.sha3(ss0marshallv2, {encoding: 'hex'})
    var buf = Utils.hexToBuffer(hash)
    var elems = []
    elems.push(buf)

    // get first eth subchannel hash (was orignally the only hash and thus the root)
    hash = web3.sha3(ss1marshall, {encoding: 'hex'})
    buf = Utils.hexToBuffer(hash)
    elems.push(buf)

    var merkle = new MerkleTree(elems)

    subchannelRootHash = Utils.bufferToHex(merkle.getRoot())

    //console.log(merkle.getRoot())
    //console.log(merkle.layers)

    var inputs = []
    inputs.push(0) // is close
    inputs.push(3) // sequence
    inputs.push(partyA) // partyA address
    inputs.push(partyB) // partyB address
    inputs.push(metachannelCTFaddress) // counterfactual metachannel address
    inputs.push(subchannelRootHash) // sub-channel root hash
    inputs.push(web3.toWei(5, 'ether')) // balance in ether partyA
    inputs.push(web3.toWei(10, 'ether')) // balance in ether partyB

    s3 = inputs
    s3marshall = Utils.marshallState(inputs)
  })

  it("both parties sign state: s3", async () => {
    s3sigA = await web3.eth.sign(partyA, web3.sha3(s3marshall, {encoding: 'hex'}))
    s3sigB = await web3.eth.sign(partyB, web3.sha3(s3marshall, {encoding: 'hex'}))
  })

  it("generate ether channel 2 payment", async () => {
    var subchannelInputs = []
    subchannelInputs.push(0) // is close
    subchannelInputs.push(1) // subchannel sequence
    subchannelInputs.push(0) // is force push channel
    subchannelInputs.push(0) // timeout length ms
    subchannelInputs.push(paymentchanneladdress) // ether payment interpreter library address
    subchannelInputs.push(ethChannelIDv2) // ID of subchannel
    subchannelInputs.push(metachannelCTFaddress) // counterfactual metachannel address
    subchannelInputs.push(reg.address) // CTF registry address
    subchannelInputs.push('0x0') // subchannel tx roothash
    subchannelInputs.push(partyA) // partyA in the subchannel
    subchannelInputs.push(partyB) // partyB in the subchannel
    subchannelInputs.push(web3.toWei(2, 'ether')) // balance of party A in subchannel (ether)
    subchannelInputs.push(web3.toWei(3, 'ether')) // balance of party B in subchannel (ether)

    ss1v2 = subchannelInputs
    ss1marshallv2 = Utils.marshallState(subchannelInputs)
    
    var hash = web3.sha3(ss1marshallv2, {encoding: 'hex'})
    var buf = Utils.hexToBuffer(hash)
    // TODO: deal with all subchannels stored as elems array, and how to replace
    // each channel independently when they are updated
    var elems = []
    elems.push(buf)

    // update again with hash of all other channel states
    hash = web3.sha3(ss1marshall, {encoding: 'hex'})
    buf = Utils.hexToBuffer(hash)
    elems.push(buf)

    var merkle = new MerkleTree(elems)

    subchannelRootHash = Utils.bufferToHex(merkle.getRoot())

    //console.log(merkle.root())

    var inputs = []
    inputs.push(0) // is close
    inputs.push(4) // sequence
    inputs.push(partyA) // partyA address
    inputs.push(partyB) // partyB address
    inputs.push(metachannelCTFaddress) // counterfactual metachannel address
    inputs.push(subchannelRootHash) // sub-channel root hash
    inputs.push(web3.toWei(5, 'ether')) // balance in ether partyA
    inputs.push(web3.toWei(10, 'ether')) // balance in ether partyB

    s4 = inputs
    s4marshall = Utils.marshallState(inputs)    
  })

  it("both parties sign state: s4", async () => {
    s4sigA = await web3.eth.sign(partyA, web3.sha3(s4marshall, {encoding: 'hex'}))
    s4sigB = await web3.eth.sign(partyB, web3.sha3(s4marshall, {encoding: 'hex'}))
  })

  it("party B instantiates metachannel (A byzantine)", async () => {
    var r = metachannelCTFsigA.substr(0,66)
    var s = "0x" + metachannelCTFsigA.substr(66,64)
    var v = parseInt(metachannelCTFsigA.substr(130, 2)) + 27

    var r2 = metachannelCTFsigB.substr(0,66)
    var s2 = "0x" + metachannelCTFsigB.substr(66,64)
    var v2 = parseInt(metachannelCTFsigB.substr(130, 2)) + 27

    var sigV = []
    var sigR = []
    var sigS = []

    sigV.push(v)
    sigV.push(v2)
    sigR.push(r)
    sigR.push(r2)
    sigS.push(s)
    sigS.push(s2)

    var receipt = await reg.deployCTF(metaCTF, sigV, sigR, sigS)
    var gasUsed = receipt.receipt.gasUsed
    //console.log('Gas Used: ' + gasUsed)

    let deployAddress = await reg.resolveAddress(metachannelCTFaddress)
    metachannel = MetaChannel.at(deployAddress)
  })

  it("party B starts settle state on ether channel", async () => {
    var r = s4sigA.substr(0,66)
    var s = "0x" + s4sigA.substr(66,64)
    var v = parseInt(s4sigA.substr(130, 2)) + 27

    var r2 = s4sigB.substr(0,66)
    var s2 = "0x" + s4sigB.substr(66,64)
    var v2 = parseInt(s4sigB.substr(130, 2)) + 27

    var sigV = []
    var sigR = []
    var sigS = []

    sigV.push(v)
    sigV.push(v2)
    sigR.push(r)
    sigR.push(r2)
    sigS.push(s)
    sigS.push(s2)

    // get merkle proof
    var hash = web3.sha3(ss1marshall, {encoding: 'hex'})
    var buf = Utils.hexToBuffer(hash)
    var elems = []
    elems.push(buf)

    hash = web3.sha3(ss1marshallv2, {encoding: 'hex'})
    buf = Utils.hexToBuffer(hash)
    elems.push(buf)

    var merkle = new MerkleTree(elems)
    var proof = merkle.proof(elems[0])
    proof.unshift(elems[0])
    proof = Utils.marshallState(proof)

    var receipt = await metachannel.startSettleStateSubchannel(proof, s4marshall, ss1marshall, sigV, sigR, sigS)
    var gasUsed = receipt.receipt.gasUsed
    //console.log('Gas Used: ' + gasUsed)

    var subchan = await metachannel.getSubChannel(ethChannelID)
    //console.log(subchan)
  })

  //TODO: Create 3rd state and challenge

  it("subchan now settling, transfer funds from msig to metachannel", async () => {
    var receipt = await msig.closeSubchannel(ethChannelID)
    var gasUsed = receipt.receipt.gasUsed
    //console.log('Gas Used: ' + gasUsed)
    //console.log(web3.eth.getBalance(metachannel.address))
  })

  it("close subchannel", async () => {
    var balA = await web3.fromWei(web3.eth.getBalance(accounts[1]), 'ether')
    var balB = await web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether')
    //console.log('Balance A before close: ' + balA)
    //console.log('Balance B before close: ' + balB)
    var metaBal = await web3.fromWei(web3.eth.getBalance(metachannel.address), 'ether')
    //console.log(metaBal)

    var receipt = await metachannel.closeWithTimeoutSubchannel(ethChannelID)
    var gasUsed = receipt.receipt.gasUsed
    //console.log('Gas Used: ' + gasUsed)

    balA = await web3.fromWei(web3.eth.getBalance(accounts[1]), 'ether')
    balB = await web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether')
    //console.log('Balance A after close: ' + balA)
    //console.log('Balance B after close: ' + balB)
    metaBal = await web3.fromWei(web3.eth.getBalance(metachannel.address), 'ether')
    //console.log(metaBal)
  })

  it("party B starts settle state on 2nd ether channel", async () => {
    var r = s4sigA.substr(0,66)
    var s = "0x" + s4sigA.substr(66,64)
    var v = parseInt(s4sigA.substr(130, 2)) + 27

    var r2 = s4sigB.substr(0,66)
    var s2 = "0x" + s4sigB.substr(66,64)
    var v2 = parseInt(s4sigB.substr(130, 2)) + 27

    var sigV = []
    var sigR = []
    var sigS = []

    sigV.push(v)
    sigV.push(v2)
    sigR.push(r)
    sigR.push(r2)
    sigS.push(s)
    sigS.push(s2)

    // get merkle proof
    var hash = web3.sha3(ss1marshallv2, {encoding: 'hex'})
    var buf = Utils.hexToBuffer(hash)
    var elems = []
    elems.push(buf)

    hash = web3.sha3(ss1marshall, {encoding: 'hex'})
    buf = Utils.hexToBuffer(hash)
    elems.push(buf)

    var merkle = new MerkleTree(elems)
    var proof = merkle.proof(elems[1])
    proof.push(elems[1])
    proof = Utils.marshallState(proof)

    var receipt = await metachannel.startSettleStateSubchannel(proof, s4marshall, ss1marshallv2, sigV, sigR, sigS)
    var gasUsed = receipt.receipt.gasUsed
    //console.log('Gas Used: ' + gasUsed)

    var subchan = await metachannel.getSubChannel(ethChannelIDv2)
    //console.log(subchan)
  })

  it("subchan 2 now settling, transfer funds from msig to metachannel", async () => {
    var receipt = await msig.closeSubchannel(ethChannelIDv2)
    var gasUsed = receipt.receipt.gasUsed
    //console.log('Gas Used: ' + gasUsed)
    //console.log(web3.eth.getBalance(metachannel.address))
  })
  
  it("close 2nd subchannel", async () => {
    var balA = await web3.fromWei(web3.eth.getBalance(accounts[1]), 'ether')
    var balB = await web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether')
    //console.log('Balance A before close: ' + balA)
    //console.log('Balance B before close: ' + balB)
    var metaBal = await web3.fromWei(web3.eth.getBalance(metachannel.address), 'ether')
    //console.log(metaBal)

    var receipt = await metachannel.closeWithTimeoutSubchannel(ethChannelIDv2)
    var gasUsed = receipt.receipt.gasUsed
    //console.log('Gas Used: ' + gasUsed)

    balA = await web3.fromWei(web3.eth.getBalance(accounts[1]), 'ether')
    balB = await web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether')
    //console.log('Balance A after close: ' + balA)
    //console.log('Balance B after close: ' + balB)
    metaBal = await web3.fromWei(web3.eth.getBalance(metachannel.address), 'ether')
    //console.log(metaBal)
  })

  it("begin settling metachannel on s4 to finalize remaining balance", async () => {
    var r = s4sigA.substr(0,66)
    var s = "0x" + s4sigA.substr(66,64)
    var v = parseInt(s4sigA.substr(130, 2)) + 27

    var r2 = s4sigB.substr(0,66)
    var s2 = "0x" + s4sigB.substr(66,64)
    var v2 = parseInt(s4sigB.substr(130, 2)) + 27

    var sigV = []
    var sigR = []
    var sigS = []

    sigV.push(v)
    sigV.push(v2)
    sigR.push(r)
    sigR.push(r2)
    sigS.push(s)
    sigS.push(s2)

    var receipt = await metachannel.startSettle(s4marshall, sigV, sigR, sigS)
    var gasUsed = receipt.receipt.gasUsed
    //console.log('Gas Used: ' + gasUsed)
  })

  it("closes the metachannel", async () => {
    var receipt = await metachannel.closeWithTimeout()
    var gasUsed = receipt.receipt.gasUsed
    //console.log('Gas Used: ' + gasUsed)   
  })

  it("finalizes the remaining msig balances", async () => {
    var balA = await web3.fromWei(web3.eth.getBalance(accounts[1]), 'ether')
    var balB = await web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether')
    //console.log('Balance A before close: ' + balA)
    //console.log('Balance B before close: ' + balB)
    var msigBal = await web3.fromWei(web3.eth.getBalance(msig.address), 'ether')
    //console.log(msigBal)

    var receipt = await msig.closeWithMetachannel()
    var gasUsed = receipt.receipt.gasUsed
    //console.log('Gas Used: ' + gasUsed)

    balA = await web3.fromWei(web3.eth.getBalance(accounts[1]), 'ether')
    balB = await web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether')
    //console.log('Balance A after close: ' + balA)
    //console.log('Balance B after close: ' + balB)
    msigBal = await web3.fromWei(web3.eth.getBalance(msig.address), 'ether')
    //console.log(msigBal)
  })
})