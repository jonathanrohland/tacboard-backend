// Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require('aws-sdk');

const ddb = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10', region: process.env.AWS_REGION });

const { CONNECTIONS_TABLE_NAME, GAMES_TABLE_NAME } = process.env;

function savStateToDB(gameId, state) {
  return ddb.put({
    TableName: GAMES_TABLE_NAME, Item: {
      gameId: gameId,
      gameStateNumAttribute: state,
      expires: Math.floor(Date.now() / 1000 + 60 * 60) // Expire in 1h
    }
  }).promise();
}

exports.handler = async event => {
  let openConnections;

  try {
    openConnections = await ddb.scan({ TableName: CONNECTIONS_TABLE_NAME, ProjectionExpression: 'connectionId' }).promise();
  } catch (e) {
    return { statusCode: 500, body: e.stack };
  }

  const apigwManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint: event.requestContext.domainName + '/' + event.requestContext.stage
  });

  const postData = JSON.parse(event.body).data;

  try {
    await savStateToDB('default', JSON.stringify(postData))
  } catch (e) {
    return { statusCode: 500, body: e.stack };
  }

  const postCalls = openConnections.Items.map(async ({ connectionId }) => {
    try {
      await apigwManagementApi.postToConnection({ ConnectionId: connectionId, Data: postData }).promise();
    } catch (e) {
      if (e.statusCode === 410) {
        console.log(`Found stale connection, deleting ${connectionId}`);
        await ddb.delete({ TableName: CONNECTIONS_TABLE_NAME, Key: { connectionId } }).promise();
      } else {
        throw e;
      }
    }
  });

  try {
    await Promise.all(postCalls);
  } catch (e) {
    return { statusCode: 500, body: e.stack };
  }

  return { statusCode: 200, body: 'Data sent.' };
};
